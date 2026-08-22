import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { serialize } from '../../utils/serialize.js';
import { logActivity } from '../../services/activity.js';
import { actor, contains, orderBy, paged, paginationSchema, skipTake, slugify } from './shared.js';

const SORTABLE = ['name', 'price', 'createdAt', 'updatedAt', 'position'] as const;

export const listQuerySchema = paginationSchema.extend({
  categoryId: z.string().min(1).optional(),
  status: z.enum(['all', 'active', 'inactive', 'archived']).default('all'),
  stock: z.enum(['all', 'in', 'out', 'low']).default('all'),
  featured: z.enum(['all', 'yes', 'no']).default('all'),
});

const listInclude = {
  category: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { position: 'asc' }, take: 1 },
  inventory: { select: { size: true, quantity: true } },
  _count: { select: { orderItems: true, processes: true } },
} as const;

/** Total units across every size. Products with no inventory rows are unlimited. */
const stockOf = (inventory: { quantity: number }[]) =>
  inventory.length === 0 ? null : inventory.reduce((sum, i) => sum + i.quantity, 0);

const LOW_STOCK_THRESHOLD = 5;

export const listProducts = asyncHandler(async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;

  const where: Prisma.ProductWhereInput = {
    ...(query.status === 'archived'
      ? { archivedAt: { not: null } }
      : {
          archivedAt: null,
          ...(query.status === 'active' ? { isActive: true } : {}),
          ...(query.status === 'inactive' ? { isActive: false } : {}),
        }),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.featured === 'yes' ? { isFeatured: true } : {}),
    ...(query.featured === 'no' ? { isFeatured: false } : {}),
    ...(query.q
      ? {
          OR: [
            { name: contains(query.q) },
            { slug: contains(query.q) },
            { sku: contains(query.q) },
            { color: contains(query.q) },
          ],
        }
      : {}),
    // Stock filters run in SQL against the inventory relation, not in JS.
    ...(query.stock === 'out' ? { inventory: { every: { quantity: 0 } } } : {}),
    ...(query.stock === 'in' ? { inventory: { some: { quantity: { gt: 0 } } } } : {}),
    ...(query.stock === 'low'
      ? { inventory: { some: { quantity: { gt: 0, lte: LOW_STOCK_THRESHOLD } } } }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: listInclude,
      orderBy: orderBy(query, SORTABLE, { createdAt: 'desc' }),
      ...skipTake(query),
    }),
    prisma.product.count({ where }),
  ]);

  const items = rows.map(({ _count, inventory, ...p }) => ({
    ...p,
    inventory,
    stock: stockOf(inventory),
    orderCount: _count.orderItems,
    processCount: _count.processes,
  }));

  res.json(serialize(paged(items, total, query)));
});

const imageSchema = z.object({
  url: z.string().trim().url('Each image needs a valid URL').max(500),
  alt: z.string().trim().max(160).nullish(),
});

const bodySchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
    .max(120)
    .optional(),
  description: z.string().trim().min(1, 'Description is required').max(4000),
  shortDescription: z.string().trim().max(300).nullish(),
  sku: z.string().trim().max(60).nullish(),
  story: z.string().trim().max(4000).nullish(),
  fabric: z.string().trim().max(1000).nullish(),
  fit: z.string().trim().max(1000).nullish(),
  care: z.string().trim().max(1000).nullish(),
  shipping: z.string().trim().max(1000).nullish(),
  price: z.coerce.number().min(0).max(10_000_000),
  /** The struck-through "was" price; must exceed `price` to make sense. */
  comparePrice: z.coerce.number().min(0).max(10_000_000).nullish(),
  color: z.string().trim().max(80).nullish(),
  categoryId: z.string().min(1).nullish(),
  isLimited: z.coerce.boolean().optional(),
  isFeatured: z.coerce.boolean().optional(),
  isActive: z.coerce.boolean().optional(),
  editionNo: z.coerce.number().int().min(0).max(100_000).nullish(),
  position: z.coerce.number().int().min(0).max(9999).optional(),
  images: z.array(imageSchema).max(12).optional(),
  sizes: z.array(z.string().trim().min(1).max(12)).max(24).optional(),
  /** Per-size stock. Omitting a size leaves its existing level untouched. */
  stock: z.record(z.string(), z.coerce.number().int().min(0).max(100_000)).optional(),
});

export const createSchema = bodySchema.refine(
  (v) => v.comparePrice == null || v.comparePrice === 0 || v.comparePrice > v.price,
  { message: 'Compare-at price must be higher than the price', path: ['comparePrice'] },
);

export const updateSchema = bodySchema.partial();

/** Validates the category exists and is not archived before assigning it. */
async function assertCategory(categoryId: string | null | undefined) {
  if (!categoryId) return;
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { id: true, archivedAt: true },
  });
  if (!category) throw HttpError.badRequest('That category does not exist');
  if (category.archivedAt) throw HttpError.badRequest('That category is archived');
}

const detailInclude = {
  category: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { position: 'asc' } },
  sizes: { orderBy: { position: 'asc' } },
  inventory: { orderBy: { size: 'asc' } },
  processes: {
    orderBy: { sortOrder: 'asc' },
    include: {
      stage: {
        select: {
          id: true,
          name: true,
          slug: true,
          defaultDuration: true,
          defaultCost: true,
          durationUnit: true,
          isActive: true,
        },
      },
    },
  },
} as const;

export const createProduct = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof createSchema>;

  const slug = input.slug ?? slugify(input.name);
  if (!slug) throw HttpError.badRequest('That name does not produce a usable slug');

  const clash = await prisma.product.findUnique({ where: { slug }, select: { id: true } });
  if (clash) throw HttpError.conflict('A product with that slug already exists');

  if (input.sku) {
    const skuClash = await prisma.product.findUnique({
      where: { sku: input.sku },
      select: { id: true },
    });
    if (skuClash) throw HttpError.conflict('That SKU is already in use');
  }

  await assertCategory(input.categoryId);

  const sizes = input.sizes ?? [];

  const product = await prisma.product.create({
    data: {
      slug,
      name: input.name,
      description: input.description,
      shortDescription: input.shortDescription ?? null,
      sku: input.sku ?? null,
      story: input.story ?? null,
      fabric: input.fabric ?? null,
      fit: input.fit ?? null,
      care: input.care ?? null,
      shipping: input.shipping ?? null,
      price: new Prisma.Decimal(input.price),
      comparePrice:
        input.comparePrice != null && input.comparePrice > 0
          ? new Prisma.Decimal(input.comparePrice)
          : null,
      color: input.color ?? null,
      categoryId: input.categoryId ?? null,
      isLimited: input.isLimited ?? false,
      isFeatured: input.isFeatured ?? false,
      isActive: input.isActive ?? true,
      editionNo: input.editionNo ?? null,
      position: input.position ?? 0,
      images: {
        create: (input.images ?? []).map((img, i) => ({
          url: img.url,
          alt: img.alt ?? `${input.name} — view ${i + 1}`,
          position: i,
        })),
      },
      sizes: { create: sizes.map((size, i) => ({ size, position: i })) },
      inventory: {
        create: sizes.map((size) => ({ size, quantity: input.stock?.[size] ?? 0 })),
      },
    },
    include: detailInclude,
  });

  await logActivity({
    ...actor(req),
    action: 'product.create',
    entity: 'Product',
    entityId: product.id,
    summary: `Created product ${product.name} at ${product.currency} ${product.price.toFixed(2)}`,
  });

  res.status(201).json(serialize({ product }));
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: detailInclude,
  });
  if (!product) throw HttpError.notFound('Product not found');

  res.json(serialize({ product, stock: stockOf(product.inventory) }));
});

export const updateProduct = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof updateSchema>;

  const existing = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: { sizes: true },
  });
  if (!existing) throw HttpError.notFound('Product not found');

  if (input.slug && input.slug !== existing.slug) {
    const clash = await prisma.product.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (clash) throw HttpError.conflict('A product with that slug already exists');
  }

  if (input.sku && input.sku !== existing.sku) {
    const clash = await prisma.product.findUnique({
      where: { sku: input.sku },
      select: { id: true },
    });
    if (clash) throw HttpError.conflict('That SKU is already in use');
  }

  if (input.categoryId !== undefined) await assertCategory(input.categoryId);

  const nextPrice = input.price !== undefined ? new Prisma.Decimal(input.price) : existing.price;
  const nextCompare =
    input.comparePrice !== undefined
      ? input.comparePrice != null && input.comparePrice > 0
        ? new Prisma.Decimal(input.comparePrice)
        : null
      : existing.comparePrice;

  if (nextCompare && nextCompare.lte(nextPrice)) {
    throw HttpError.badRequest('Compare-at price must be higher than the price');
  }

  const product = await prisma.$transaction(async (tx) => {
    await tx.product.update({
      where: { id: existing.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.slug !== undefined ? { slug: input.slug } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.shortDescription !== undefined
          ? { shortDescription: input.shortDescription }
          : {}),
        ...(input.sku !== undefined ? { sku: input.sku } : {}),
        ...(input.story !== undefined ? { story: input.story } : {}),
        ...(input.fabric !== undefined ? { fabric: input.fabric } : {}),
        ...(input.fit !== undefined ? { fit: input.fit } : {}),
        ...(input.care !== undefined ? { care: input.care } : {}),
        ...(input.shipping !== undefined ? { shipping: input.shipping } : {}),
        ...(input.price !== undefined ? { price: nextPrice } : {}),
        ...(input.comparePrice !== undefined ? { comparePrice: nextCompare } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
        ...(input.isLimited !== undefined ? { isLimited: input.isLimited } : {}),
        ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.editionNo !== undefined ? { editionNo: input.editionNo } : {}),
        ...(input.position !== undefined ? { position: input.position } : {}),
      },
    });

    // Images are replaced wholesale — the editor always submits the full list.
    if (input.images) {
      await tx.productImage.deleteMany({ where: { productId: existing.id } });
      if (input.images.length > 0) {
        await tx.productImage.createMany({
          data: input.images.map((img, i) => ({
            productId: existing.id,
            url: img.url,
            alt: img.alt ?? `${input.name ?? existing.name} — view ${i + 1}`,
            position: i,
          })),
        });
      }
    }

    if (input.sizes) {
      const keep = new Set(input.sizes);

      // Dropping a size removes its stock row too, but never touches an
      // OrderItem — those snapshot their own size string.
      await tx.productSize.deleteMany({
        where: { productId: existing.id, size: { notIn: input.sizes } },
      });
      await tx.inventory.deleteMany({
        where: { productId: existing.id, size: { notIn: input.sizes } },
      });

      for (const [i, size] of input.sizes.entries()) {
        await tx.productSize.upsert({
          where: { productId_size: { productId: existing.id, size } },
          create: { productId: existing.id, size, position: i },
          update: { position: i },
        });
      }

      // Ensure every retained size has an inventory row to edit.
      for (const size of keep) {
        await tx.inventory.upsert({
          where: { productId_size: { productId: existing.id, size } },
          create: { productId: existing.id, size, quantity: input.stock?.[size] ?? 0 },
          update:
            input.stock?.[size] !== undefined ? { quantity: input.stock[size] } : {},
        });
      }
    } else if (input.stock) {
      for (const [size, quantity] of Object.entries(input.stock)) {
        await tx.inventory.upsert({
          where: { productId_size: { productId: existing.id, size } },
          create: { productId: existing.id, size, quantity },
          update: { quantity },
        });
      }
    }

    return tx.product.findUniqueOrThrow({
      where: { id: existing.id },
      include: detailInclude,
    });
  });

  // Price moves are the edit most worth an explicit audit line.
  const summary = !existing.price.equals(product.price)
    ? `Changed ${product.name} price from ${existing.price.toFixed(2)} to ${product.price.toFixed(2)}`
    : input.isActive === false
      ? `Disabled product ${product.name}`
      : input.isActive === true
        ? `Enabled product ${product.name}`
        : `Updated product ${product.name}`;

  await logActivity({
    ...actor(req),
    action: 'product.update',
    entity: 'Product',
    entityId: product.id,
    summary,
    meta: { changes: Object.keys(input) },
  });

  res.json(serialize({ product }));
});

/**
 * Archive when the product appears in order history — OrderItem restricts
 * deletes on purpose, so historical orders can always resolve their product.
 */
export const deleteProduct = asyncHandler(async (req, res) => {
  const existing = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { orderItems: true } } },
  });
  if (!existing) throw HttpError.notFound('Product not found');

  if (existing._count.orderItems > 0) {
    const product = await prisma.product.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), isActive: false, isFeatured: false },
    });

    await logActivity({
      ...actor(req),
      action: 'product.archive',
      entity: 'Product',
      entityId: product.id,
      summary: `Archived product ${product.name} (appears in ${existing._count.orderItems} order lines)`,
    });

    return res.json(serialize({ product, archived: true }));
  }

  // Re-check inside the transaction: an order placed between the count above
  // and the delete would otherwise hit the OrderItem Restrict constraint and
  // surface as a 500 instead of an archive.
  const archived = await prisma.$transaction(async (tx) => {
    const stillReferenced = await tx.orderItem.count({ where: { productId: existing.id } });
    if (stillReferenced === 0) {
      await tx.product.delete({ where: { id: existing.id } });
      return null;
    }
    return tx.product.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), isActive: false, isFeatured: false },
    });
  });

  if (archived) {
    await logActivity({
      ...actor(req),
      action: 'product.archive',
      entity: 'Product',
      entityId: archived.id,
      summary: `Archived product ${archived.name} (ordered while being deleted)`,
    });

    return res.json(serialize({ product: archived, archived: true }));
  }

  await logActivity({
    ...actor(req),
    action: 'product.delete',
    entity: 'Product',
    entityId: existing.id,
    summary: `Deleted product ${existing.name}`,
  });

  res.json({ ok: true, archived: false });
});

export const restoreProduct = asyncHandler(async (req, res) => {
  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: { archivedAt: null },
  });

  await logActivity({
    ...actor(req),
    action: 'product.restore',
    entity: 'Product',
    entityId: product.id,
    summary: `Restored product ${product.name}`,
  });

  res.json(serialize({ product }));
});

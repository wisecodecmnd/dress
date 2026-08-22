import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { serialize } from '../../utils/serialize.js';
import { logActivity } from '../../services/activity.js';
import { getSettings } from '../../services/settings.js';
import { actor, contains, orderBy, paged, paginationSchema, skipTake, slugify } from './shared.js';

const SORTABLE = ['name', 'slug', 'position', 'createdAt', 'updatedAt'] as const;

export const listQuerySchema = paginationSchema.extend({
  status: z.enum(['all', 'active', 'inactive', 'archived']).default('all'),
  featured: z.enum(['all', 'yes', 'no']).default('all'),
});

export const listCategories = asyncHandler(async (req, res) => {
  const query = req.query as unknown as z.infer<typeof listQuerySchema>;

  const where = {
    ...(query.status === 'archived'
      ? { archivedAt: { not: null } }
      : { archivedAt: null, ...(query.status === 'active' ? { isActive: true } : {}), ...(query.status === 'inactive' ? { isActive: false } : {}) }),
    ...(query.featured === 'yes' ? { isFeatured: true } : {}),
    ...(query.featured === 'no' ? { isFeatured: false } : {}),
    ...(query.q
      ? { OR: [{ name: contains(query.q) }, { slug: contains(query.q) }] }
      : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.category.findMany({
      where,
      orderBy: orderBy(query, SORTABLE, { position: 'asc' }),
      ...skipTake(query),
      include: { _count: { select: { products: true } } },
    }),
    prisma.category.count({ where }),
  ]);

  const items = rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products }));

  res.json(serialize(paged(items, total, query)));
});

const bodySchema = z.object({
  name: z.string().trim().min(2, 'Name is required').max(80),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and hyphens')
    .max(80)
    .optional(),
  description: z.string().trim().max(600).nullish(),
  image: z.string().trim().url('Enter a valid image URL').max(500).nullish(),
  position: z.coerce.number().int().min(0).max(9999).optional(),
  isActive: z.coerce.boolean().optional(),
  isFeatured: z.coerce.boolean().optional(),
});

export const createSchema = bodySchema;
export const updateSchema = bodySchema.partial();

export const createCategory = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof createSchema>;
  const settings = await getSettings();

  const slug = input.slug ?? slugify(input.name);
  if (!slug) throw HttpError.badRequest('That name does not produce a usable slug');

  const clash = await prisma.category.findUnique({ where: { slug }, select: { id: true } });
  if (clash) throw HttpError.conflict('A category with that slug already exists');

  const category = await prisma.category.create({
    data: {
      name: input.name,
      slug,
      description: input.description ?? null,
      image: input.image ?? null,
      position: input.position ?? 0,
      isActive: input.isActive ?? settings.defaultCategoryVisible,
      isFeatured: input.isFeatured ?? false,
    },
  });

  await logActivity({
    ...actor(req),
    action: 'category.create',
    entity: 'Category',
    entityId: category.id,
    summary: `Created category ${category.name} (/shop/${category.slug})`,
  });

  res.status(201).json(serialize({ category }));
});

export const getCategory = asyncHandler(async (req, res) => {
  const category = await prisma.category.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { products: true } } },
  });
  if (!category) throw HttpError.notFound('Category not found');

  const { _count, ...rest } = category;
  res.json(serialize({ category: { ...rest, productCount: _count.products } }));
});

export const updateCategory = asyncHandler(async (req, res) => {
  const input = req.body as z.infer<typeof updateSchema>;

  const existing = await prisma.category.findUnique({ where: { id: req.params.id } });
  if (!existing) throw HttpError.notFound('Category not found');

  // Changing the slug changes the storefront URL, so guard uniqueness.
  if (input.slug && input.slug !== existing.slug) {
    const clash = await prisma.category.findUnique({
      where: { slug: input.slug },
      select: { id: true },
    });
    if (clash) throw HttpError.conflict('A category with that slug already exists');
  }

  const category = await prisma.category.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.slug !== undefined ? { slug: input.slug } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.image !== undefined ? { image: input.image } : {}),
      ...(input.position !== undefined ? { position: input.position } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
    },
  });

  const changes = Object.keys(input).filter((k) => k in input);

  await logActivity({
    ...actor(req),
    action: 'category.update',
    entity: 'Category',
    entityId: category.id,
    summary:
      input.slug && input.slug !== existing.slug
        ? `Changed ${existing.name} slug from ${existing.slug} to ${category.slug}`
        : input.isActive === false
          ? `Disabled category ${category.name}`
          : input.isActive === true
            ? `Enabled category ${category.name}`
            : `Updated category ${category.name}`,
    meta: { changes },
  });

  res.json(serialize({ category }));
});

/**
 * Archive rather than delete when products still point at the category, so
 * historical orders keep a resolvable category. An empty category is deleted
 * outright.
 */
export const deleteCategory = asyncHandler(async (req, res) => {
  const existing = await prisma.category.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { products: true } } },
  });
  if (!existing) throw HttpError.notFound('Category not found');

  if (existing._count.products > 0) {
    const category = await prisma.category.update({
      where: { id: existing.id },
      data: { archivedAt: new Date(), isActive: false, isFeatured: false },
    });

    await logActivity({
      ...actor(req),
      action: 'category.archive',
      entity: 'Category',
      entityId: category.id,
      summary: `Archived category ${category.name} (${existing._count.products} products kept)`,
    });

    return res.json(serialize({ category, archived: true }));
  }

  await prisma.category.delete({ where: { id: existing.id } });

  await logActivity({
    ...actor(req),
    action: 'category.delete',
    entity: 'Category',
    entityId: existing.id,
    summary: `Deleted empty category ${existing.name}`,
  });

  res.json({ ok: true, archived: false });
});

export const restoreCategory = asyncHandler(async (req, res) => {
  const category = await prisma.category.update({
    where: { id: req.params.id },
    data: { archivedAt: null },
  });

  await logActivity({
    ...actor(req),
    action: 'category.restore',
    entity: 'Category',
    entityId: category.id,
    summary: `Restored category ${category.name}`,
  });

  res.json(serialize({ category }));
});

export const reorderSchema = z.object({
  order: z.array(z.object({ id: z.string().min(1), position: z.coerce.number().int().min(0) })).min(1).max(200),
});

export const reorderCategories = asyncHandler(async (req, res) => {
  const { order } = req.body as z.infer<typeof reorderSchema>;

  await prisma.$transaction(
    order.map((row) =>
      prisma.category.update({ where: { id: row.id }, data: { position: row.position } }),
    ),
  );

  await logActivity({
    ...actor(req),
    action: 'category.reorder',
    entity: 'Category',
    summary: `Reordered ${order.length} categories`,
  });

  res.json({ ok: true });
});

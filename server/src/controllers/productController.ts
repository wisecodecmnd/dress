import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler, HttpError } from '../utils/http.js';
import { serialize } from '../utils/serialize.js';

export const listQuerySchema = z.object({
  category: z.string().trim().min(1).optional(),
  sort: z.enum(['newest', 'price-asc', 'price-desc']).default('newest'),
  featured: z.enum(['true', 'false']).optional(),
  limited: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  page: z.coerce.number().int().min(1).default(1),
});

const productInclude = {
  category: { select: { id: true, name: true, slug: true, description: true } },
  images: { orderBy: { position: 'asc' } },
  sizes: { orderBy: { position: 'asc' } },
  inventory: { select: { size: true, quantity: true } },
} as const;

const orderByFor = (sort: string) => {
  if (sort === 'price-asc') return { price: 'asc' } as const;
  if (sort === 'price-desc') return { price: 'desc' } as const;
  return { createdAt: 'desc' } as const;
};

/** Only categories an admin has left visible reach the storefront. */
const publicCategoryWhere = { isActive: true, archivedAt: null } as const;

export const listProducts = asyncHandler(async (req, res) => {
  const { category, sort, featured, limited, limit, page } = req.query as unknown as z.infer<
    typeof listQuerySchema
  >;

  // Any slug an admin creates resolves here — there is no per-category code.
  const real = category
    ? await prisma.category.findFirst({
        where: { slug: category, isActive: true, archivedAt: null },
        select: { id: true },
      })
    : null;

  // `limited-editions` has always been backed by the isLimited flag rather
  // than an assignment. It stays that way, unioned with anything an admin
  // explicitly files under the category, so neither behaviour is lost.
  const categoryFilter = (() => {
    if (!category) return {};

    if (category === 'limited-editions') {
      return real
        ? { OR: [{ isLimited: true }, { categoryId: real.id }] }
        : { isLimited: true };
    }

    // An unknown, disabled or archived slug yields nothing — never the whole
    // catalogue.
    return { categoryId: real?.id ?? '__no_such_category__' };
  })();

  const where = {
    isActive: true,
    archivedAt: null,
    ...categoryFilter,
    ...(featured === 'true' ? { isFeatured: true } : {}),
    ...(limited === 'true' ? { isLimited: true } : {}),
  };

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: productInclude,
      orderBy: orderByFor(sort),
      take: limit,
      skip: (page - 1) * limit,
    }),
    prisma.product.count({ where }),
  ]);

  res.json(serialize({ products, total, page, pageSize: limit }));
});

export const getProduct = asyncHandler(async (req, res) => {
  const product = await prisma.product.findFirst({
    where: { slug: req.params.slug, isActive: true, archivedAt: null },
    include: productInclude,
  });

  if (!product) throw HttpError.notFound('That piece is no longer available');

  res.json(serialize({ product }));
});

/**
 * Drives the storefront's category navigation. Because the shop route is
 * `/shop/:categorySlug`, adding a category in admin is all it takes for a new
 * URL to work — no code change, no redeploy.
 */
export const listCategories = asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    where: publicCategoryWhere,
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      image: true,
      isFeatured: true,
      _count: { select: { products: { where: { isActive: true, archivedAt: null } } } },
    },
  });

  res.json({
    categories: categories.map(({ _count, ...c }) => ({ ...c, productCount: _count.products })),
  });
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search for at least two characters').max(64),
});

export const searchProducts = asyncHandler(async (req, res) => {
  const { q } = req.query as unknown as z.infer<typeof searchQuerySchema>;

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { color: { contains: q, mode: 'insensitive' } },
        { category: { name: { contains: q, mode: 'insensitive' } } },
      ],
    },
    include: productInclude,
    take: 12,
  });

  res.json(serialize({ products }));
});

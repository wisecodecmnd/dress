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

export const listProducts = asyncHandler(async (req, res) => {
  const { category, sort, featured, limited, limit, page } = req.query as unknown as z.infer<
    typeof listQuerySchema
  >;

  // `limited-editions` is a virtual category backed by the isLimited flag.
  const isLimitedCategory = category === 'limited-editions';

  const where = {
    isActive: true,
    ...(isLimitedCategory ? { isLimited: true } : {}),
    ...(category && !isLimitedCategory ? { category: { slug: category } } : {}),
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
    where: { slug: req.params.slug, isActive: true },
    include: productInclude,
  });

  if (!product) throw HttpError.notFound('That piece is no longer available');

  res.json(serialize({ product }));
});

export const listCategories = asyncHandler(async (_req, res) => {
  const categories = await prisma.category.findMany({
    orderBy: { position: 'asc' },
    select: { id: true, name: true, slug: true, description: true },
  });

  res.json({ categories });
});

export const searchQuerySchema = z.object({
  q: z.string().trim().min(2, 'Search for at least two characters').max(64),
});

export const searchProducts = asyncHandler(async (req, res) => {
  const { q } = req.query as unknown as z.infer<typeof searchQuerySchema>;

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
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

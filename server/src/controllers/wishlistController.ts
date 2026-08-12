import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler, HttpError } from '../utils/http.js';
import { serialize } from '../utils/serialize.js';

export const addSchema = z.object({ productId: z.string().min(1) });

const itemInclude = {
  product: {
    include: {
      images: { orderBy: { position: 'asc' }, take: 2 },
      sizes: { orderBy: { position: 'asc' } },
      category: { select: { id: true, name: true, slug: true } },
    },
  },
} as const;

async function wishlistFor(userId: string) {
  const existing = await prisma.wishlist.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return existing;
  return prisma.wishlist.create({ data: { userId }, select: { id: true } });
}

export const getWishlist = asyncHandler(async (req, res) => {
  const wishlist = await wishlistFor(req.auth!.sub);

  const items = await prisma.wishlistItem.findMany({
    where: { wishlistId: wishlist.id },
    include: itemInclude,
    orderBy: { createdAt: 'desc' },
  });

  res.json(serialize({ items }));
});

export const addItem = asyncHandler(async (req, res) => {
  const { productId } = req.body as z.infer<typeof addSchema>;

  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true },
  });
  if (!product) throw HttpError.notFound('That piece is unavailable');

  const wishlist = await wishlistFor(req.auth!.sub);

  // Saving twice is a no-op rather than an error.
  const item = await prisma.wishlistItem.upsert({
    where: { wishlistId_productId: { wishlistId: wishlist.id, productId } },
    create: { wishlistId: wishlist.id, productId },
    update: {},
    include: itemInclude,
  });

  res.status(201).json(serialize({ item }));
});

export const removeItem = asyncHandler(async (req, res) => {
  const wishlist = await wishlistFor(req.auth!.sub);

  // Accept either the row id or the product id — the client keys guest
  // wishlists by productId and only reconciles with the server on sign-in.
  const { count } = await prisma.wishlistItem.deleteMany({
    where: {
      wishlistId: wishlist.id,
      OR: [{ id: req.params.itemId }, { productId: req.params.itemId }],
    },
  });
  if (count === 0) throw HttpError.notFound('That item is not saved');

  res.json({ ok: true });
});

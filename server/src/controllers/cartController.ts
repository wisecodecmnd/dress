import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler, HttpError } from '../utils/http.js';
import { serialize } from '../utils/serialize.js';

export const addItemSchema = z.object({
  productId: z.string().min(1),
  size: z.string().trim().min(1).max(12),
  quantity: z.coerce.number().int().min(1).max(10),
});

export const updateItemSchema = z.object({
  quantity: z.coerce.number().int().min(1).max(10),
});

const itemInclude = {
  product: {
    include: {
      images: { orderBy: { position: 'asc' }, take: 2 },
      sizes: { orderBy: { position: 'asc' } },
      category: { select: { id: true, name: true, slug: true } },
    },
  },
} as const;

/** Every user is created with a cart; this covers pre-existing rows. */
async function cartFor(userId: string) {
  const existing = await prisma.cart.findUnique({ where: { userId }, select: { id: true } });
  if (existing) return existing;
  return prisma.cart.create({ data: { userId }, select: { id: true } });
}

export const getCart = asyncHandler(async (req, res) => {
  const cart = await cartFor(req.auth!.sub);

  const items = await prisma.cartItem.findMany({
    where: { cartId: cart.id },
    include: itemInclude,
    orderBy: { id: 'asc' },
  });

  res.json(serialize({ items }));
});

export const addItem = asyncHandler(async (req, res) => {
  const { productId, size, quantity } = req.body as z.infer<typeof addItemSchema>;

  const product = await prisma.product.findFirst({
    where: { id: productId, isActive: true },
    select: { id: true },
  });
  if (!product) throw HttpError.notFound('That piece is unavailable');

  const stock = await prisma.inventory.findUnique({
    where: { productId_size: { productId, size } },
    select: { quantity: true },
  });
  if (stock && stock.quantity < quantity) {
    throw HttpError.badRequest(`Only ${stock.quantity} left in size ${size}`);
  }

  const cart = await cartFor(req.auth!.sub);

  // Adding the same product+size again increments rather than duplicating.
  const item = await prisma.cartItem.upsert({
    where: { cartId_productId_size: { cartId: cart.id, productId, size } },
    create: { cartId: cart.id, productId, size, quantity },
    update: { quantity: { increment: quantity } },
    include: itemInclude,
  });

  res.status(201).json(serialize({ item }));
});

export const updateItem = asyncHandler(async (req, res) => {
  const { quantity } = req.body as z.infer<typeof updateItemSchema>;
  const cart = await cartFor(req.auth!.sub);

  // Scoped by cartId so one user can't touch another's line items.
  const existing = await prisma.cartItem.findFirst({
    where: { id: req.params.itemId, cartId: cart.id },
    select: { id: true },
  });
  if (!existing) throw HttpError.notFound('That item is not in your cart');

  const item = await prisma.cartItem.update({
    where: { id: existing.id },
    data: { quantity },
    include: itemInclude,
  });

  res.json(serialize({ item }));
});

export const removeItem = asyncHandler(async (req, res) => {
  const cart = await cartFor(req.auth!.sub);

  const { count } = await prisma.cartItem.deleteMany({
    where: { id: req.params.itemId, cartId: cart.id },
  });
  if (count === 0) throw HttpError.notFound('That item is not in your cart');

  res.json({ ok: true });
});

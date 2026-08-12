import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler, HttpError } from '../utils/http.js';
import { serialize } from '../utils/serialize.js';
import { computeTotals, orderNumber, type LinePrice } from '../services/pricing.js';
import { sendEmail, templates } from '../services/email.js';

const addressSchema = z.object({
  label: z.string().trim().max(40).nullish(),
  line1: z.string().trim().min(4).max(160),
  line2: z.string().trim().max(160).nullish(),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  country: z.string().trim().min(2).max(80),
  pincode: z.string().trim().regex(/^\d{4,10}$/, 'Enter a valid postal code'),
});

export const createOrderSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Enter a valid email'),
    phone: z.string().trim().min(7).max(20),
    addressId: z.string().min(1).optional(),
    address: addressSchema.optional(),
    items: z
      .array(
        z.object({
          productId: z.string().min(1),
          size: z.string().trim().min(1).max(12),
          quantity: z.coerce.number().int().min(1).max(10),
        }),
      )
      .min(1)
      .max(30)
      .optional(),
  })
  .refine((v) => Boolean(v.addressId || v.address), {
    message: 'A shipping address is required',
    path: ['address'],
  });

type CreateOrderInput = z.infer<typeof createOrderSchema>;

const orderInclude = {
  items: true,
  address: true,
  payment: {
    select: { id: true, provider: true, status: true, amount: true, reference: true },
  },
} as const;

export const createOrder = asyncHandler(async (req, res) => {
  const input = req.body as CreateOrderInput;
  const userId = req.auth?.sub ?? null;

  // Signed-in callers with no explicit basket fall back to their server cart,
  // so a stale client payload can't rewrite what they're buying.
  let requested = input.items ?? [];

  if (requested.length === 0) {
    if (!userId) throw HttpError.badRequest('Your cart is empty');

    const cartItems = await prisma.cartItem.findMany({
      where: { cart: { userId } },
      select: { productId: true, size: true, quantity: true },
    });
    if (cartItems.length === 0) throw HttpError.badRequest('Your cart is empty');
    requested = cartItems;
  }

  const order = await prisma.$transaction(async (tx) => {
    // 1. Price every line from the database. The client's numbers are ignored.
    const products = await tx.product.findMany({
      where: { id: { in: requested.map((i) => i.productId) }, isActive: true },
      include: { images: { orderBy: { position: 'asc' }, take: 1 } },
    });

    const byId = new Map(products.map((p) => [p.id, p]));
    const lines: LinePrice[] = [];

    for (const item of requested) {
      const product = byId.get(item.productId);
      if (!product) throw HttpError.badRequest('One of the pieces is no longer available');

      // 2. Reserve stock. Rows without an inventory record are unlimited.
      const stock = await tx.inventory.findUnique({
        where: { productId_size: { productId: product.id, size: item.size } },
      });

      if (stock) {
        if (stock.quantity < item.quantity) {
          throw HttpError.badRequest(
            `${product.name} in size ${item.size} only has ${stock.quantity} left`,
          );
        }
        await tx.inventory.update({
          where: { id: stock.id },
          data: { quantity: { decrement: item.quantity } },
        });
      }

      lines.push({
        productId: product.id,
        name: product.name,
        image: product.images[0]?.url ?? null,
        size: item.size,
        quantity: item.quantity,
        unitPrice: product.price,
      });
    }

    const { subtotal, shipping, tax, total } = computeTotals(lines);

    // 3. Resolve the shipping address.
    let addressId = input.addressId ?? null;

    if (addressId) {
      const owned = await tx.address.findFirst({
        where: { id: addressId, OR: [{ userId }, { userId: null }] },
        select: { id: true },
      });
      if (!owned) throw HttpError.notFound('That address could not be found');
    } else if (input.address) {
      const created = await tx.address.create({
        data: {
          userId,
          label: input.address.label ?? 'Shipping',
          line1: input.address.line1,
          line2: input.address.line2 ?? null,
          city: input.address.city,
          state: input.address.state,
          country: input.address.country,
          pincode: input.address.pincode,
        },
        select: { id: true },
      });
      addressId = created.id;
    }

    // 4. Create the order as PENDING with a matching PENDING payment row.
    //    Nothing is marked paid until a provider callback says so.
    const created = await tx.order.create({
      data: {
        number: orderNumber(),
        userId,
        email: input.email,
        phone: input.phone,
        addressId,
        subtotal,
        shipping,
        tax,
        total,
        items: {
          create: lines.map((l) => ({
            productId: l.productId,
            name: l.name,
            image: l.image,
            size: l.size,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
          })),
        },
        payment: {
          create: { provider: 'pending', amount: total, status: 'PENDING' },
        },
      },
      include: orderInclude,
    });

    // 5. Clear the server cart now the basket has become an order.
    if (userId) {
      await tx.cartItem.deleteMany({ where: { cart: { userId } } });
    }

    return created;
  });

  // Email is best-effort: a transport failure must not void a placed order.
  void sendEmail({
    to: order.email,
    ...templates.orderConfirmation({
      number: order.number,
      total: order.total.toFixed(2),
      currency: order.currency,
    }),
  }).catch((err) => console.error('[api] order email failed', err));

  res.status(201).json(serialize({ order }));
});

export const listOrders = asyncHandler(async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.auth!.sub },
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
  });

  res.json(serialize({ orders }));
});

export const getOrder = asyncHandler(async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: orderInclude,
  });

  if (!order) throw HttpError.notFound('Order not found');

  // Guest orders are reachable by their unguessable id (that's the link in the
  // confirmation email); orders owned by an account require that account.
  if (order.userId && order.userId !== req.auth?.sub) {
    throw HttpError.forbidden('That order belongs to another account');
  }

  res.json(serialize({ order }));
});

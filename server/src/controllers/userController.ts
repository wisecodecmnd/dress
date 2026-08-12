import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler, HttpError } from '../utils/http.js';

export const addressSchema = z.object({
  label: z.string().trim().max(40).nullish(),
  line1: z.string().trim().min(4).max(160),
  line2: z.string().trim().max(160).nullish(),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  country: z.string().trim().min(2).max(80),
  pincode: z.string().trim().regex(/^\d{4,10}$/, 'Enter a valid postal code'),
});

export const profileSchema = z.object({
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
  phone: z.string().trim().max(20).optional(),
});

export const listAddresses = asyncHandler(async (req, res) => {
  const addresses = await prisma.address.findMany({
    where: { userId: req.auth!.sub },
    orderBy: { createdAt: 'desc' },
  });

  res.json({ addresses });
});

export const createAddress = asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof addressSchema>;

  const address = await prisma.address.create({
    data: {
      userId: req.auth!.sub,
      label: body.label ?? 'Shipping',
      line1: body.line1,
      line2: body.line2 ?? null,
      city: body.city,
      state: body.state,
      country: body.country,
      pincode: body.pincode,
    },
  });

  res.status(201).json({ address });
});

export const deleteAddress = asyncHandler(async (req, res) => {
  const { count } = await prisma.address.deleteMany({
    where: { id: req.params.id, userId: req.auth!.sub },
  });
  if (count === 0) throw HttpError.notFound('Address not found');

  res.json({ ok: true });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof profileSchema>;

  const user = await prisma.user.update({
    where: { id: req.auth!.sub },
    data: body,
    select: { id: true, email: true, firstName: true, lastName: true, role: true },
  });

  res.json({ user });
});

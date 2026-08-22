import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler, HttpError } from '../utils/http.js';
import { clearAuthCookie, setAuthCookie, signToken } from '../middleware/auth.js';
import { logActivityAsync } from '../services/activity.js';

const BCRYPT_ROUNDS = 12;

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  firstName: z.string().trim().max(60).optional(),
  lastName: z.string().trim().max(60).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

const publicUser = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  role: true,
} as const;

export const register = asyncHandler(async (req, res) => {
  const { email, password, firstName, lastName } = req.body as z.infer<typeof registerSchema>;

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw HttpError.conflict('An account with that email already exists');

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      firstName,
      lastName,
      // Every user gets a cart and wishlist up front, so writes never need upserts.
      cart: { create: {} },
      wishlist: { create: {} },
    },
    select: publicUser,
  });

  setAuthCookie(res, signToken({ sub: user.id, email: user.email, role: user.role }));

  // Surfaces the signup in the admin activity feed and dashboard immediately.
  logActivityAsync({
    action: 'customer.register',
    entity: 'Customer',
    entityId: user.id,
    summary: `New customer ${[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email} registered`,
    actorId: user.id,
    actorEmail: user.email,
  });

  res.status(201).json({ user });
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  const user = await prisma.user.findUnique({ where: { email } });

  // Same message either way — don't reveal which emails are registered.
  const invalid = HttpError.unauthorized('Email or password is incorrect');
  if (!user) throw invalid;

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) throw invalid;

  // A suspended account can still fail closed without leaking that it exists
  // to an attacker who doesn't already have the password.
  if (!user.isActive) throw HttpError.forbidden('This account has been suspended');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  setAuthCookie(res, signToken({ sub: user.id, email: user.email, role: user.role }));

  res.json({
    user: {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
    },
  });
});

export const logout = asyncHandler(async (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

export const me = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.sub },
    select: publicUser,
  });

  if (!user) throw HttpError.unauthorized('Your account no longer exists');

  res.json({ user });
});

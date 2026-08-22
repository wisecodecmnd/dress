import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { asyncHandler, HttpError } from '../../utils/http.js';
import { clearAuthCookie, setAuthCookie, signToken } from '../../middleware/auth.js';
import { logActivity } from '../../services/activity.js';

/**
 * Admin sign-in. Deliberately separate from the storefront login so the role
 * check happens *before* a session is issued: a customer who posts here never
 * receives a cookie at all.
 *
 * Passwords are verified against the same bcrypt hashes as the storefront —
 * there is no second credential store and no hardcoded account anywhere.
 */
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>;

  const user = await prisma.user.findUnique({ where: { email } });

  // One message for every failure mode — wrong email, wrong password, or a
  // valid customer trying the admin door. Don't confirm which.
  const invalid = HttpError.unauthorized('Email or password is incorrect');
  if (!user) throw invalid;

  const matches = await bcrypt.compare(password, user.passwordHash);
  if (!matches) throw invalid;
  if (user.role !== 'ADMIN') throw invalid;
  if (!user.isActive) throw HttpError.forbidden('This account has been suspended');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  setAuthCookie(res, signToken({ sub: user.id, email: user.email, role: user.role }));

  await logActivity({
    action: 'admin.login',
    entity: 'Admin',
    entityId: user.id,
    summary: `${user.email} signed in to admin`,
    actorId: user.id,
    actorEmail: user.email,
  });

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

/** Validates the session and confirms the ADMIN role on every page load. */
export const me = asyncHandler(async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.sub },
    select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true },
  });

  if (!user || user.role !== 'ADMIN') throw HttpError.forbidden();
  if (!user.isActive) throw HttpError.forbidden('This account has been suspended');

  res.json({ user });
});

export const logout = asyncHandler(async (req, res) => {
  clearAuthCookie(res);

  if (req.auth) {
    await logActivity({
      action: 'admin.logout',
      entity: 'Admin',
      entityId: req.auth.sub,
      summary: `${req.auth.email} signed out of admin`,
      actorId: req.auth.sub,
      actorEmail: req.auth.email,
    });
  }

  res.json({ ok: true });
});

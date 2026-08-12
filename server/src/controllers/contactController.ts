import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler } from '../utils/http.js';
import { env } from '../config/env.js';
import { sendEmail, templates } from '../services/email.js';

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Tell us your name').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone: z.string().trim().max(20).optional(),
  subject: z.string().trim().min(3, 'Add a subject').max(120),
  message: z.string().trim().min(10, 'Add a little more detail').max(4000),
});

export const submitContact = asyncHandler(async (req, res) => {
  const body = req.body as z.infer<typeof contactSchema>;

  // Persist first: the record is the source of truth even if email fails.
  const contact = await prisma.contact.create({
    data: body,
    select: { id: true },
  });

  await Promise.allSettled([
    sendEmail({
      to: env.CONTACT_INBOX,
      subject: `[Contact] ${body.subject}`,
      replyTo: body.email,
      text: [
        `From: ${body.name} <${body.email}>`,
        body.phone ? `Phone: ${body.phone}` : null,
        `Ref: ${contact.id}`,
        '',
        body.message,
      ]
        .filter(Boolean)
        .join('\n'),
    }),
    sendEmail({ to: body.email, ...templates.contactReceipt(body.name) }),
  ]);

  res.status(201).json({ ok: true });
});

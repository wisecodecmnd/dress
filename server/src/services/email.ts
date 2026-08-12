import { env } from '../config/env.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  replyTo?: string;
}

/**
 * Email boundary. The default `log` transport writes to stdout so local
 * development never sends real mail; set EMAIL_PROVIDER=resend with
 * RESEND_API_KEY to deliver for real.
 */
async function sendViaResend(message: EmailMessage): Promise<void> {
  if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY is not set');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      reply_to: message.replyTo,
    }),
  });

  if (!res.ok) {
    throw new Error(`Resend rejected the message (${res.status}): ${await res.text()}`);
  }
}

export async function sendEmail(message: EmailMessage): Promise<void> {
  switch (env.EMAIL_PROVIDER) {
    case 'resend':
      await sendViaResend(message);
      return;

    case 'smtp':
      // Add nodemailer here when an SMTP relay is chosen; deliberately not a
      // silent no-op, so a misconfiguration is visible.
      throw new Error('SMTP transport is not implemented — use EMAIL_PROVIDER=resend or log');

    case 'log':
    default:
      console.info(
        `[email:log] to=${message.to} subject="${message.subject}"\n${message.text}\n`,
      );
  }
}

export const templates = {
  orderConfirmation: (input: { number: string; total: string; currency: string }) => ({
    subject: `DENIMQUE — order ${input.number} received`,
    text: [
      `Thank you for your order.`,
      ``,
      `Order: ${input.number}`,
      `Total: ${input.currency} ${input.total}`,
      ``,
      `We'll email again the moment payment clears and the piece is dispatched.`,
      ``,
      `DENIMQUE · Biella`,
    ].join('\n'),
  }),

  contactReceipt: (name: string) => ({
    subject: 'DENIMQUE — we have your message',
    text: `${name}, thank you for writing. Someone from the atelier replies within two working days.\n\nDENIMQUE`,
  }),
};

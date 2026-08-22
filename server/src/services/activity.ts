import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

/**
 * Audit trail. Every admin mutation and notable customer event writes one row;
 * the admin activity panel and dashboard notifications read straight from it.
 *
 * Logging is best-effort by design: an audit write must never be the reason a
 * customer's order or registration fails.
 */
export interface ActivityInput {
  action: string;
  entity: string;
  entityId?: string | null;
  summary: string;
  actorId?: string | null;
  actorEmail?: string | null;
  meta?: Prisma.InputJsonValue;
}

export async function logActivity(input: ActivityInput): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        action: input.action,
        entity: input.entity,
        entityId: input.entityId ?? null,
        summary: input.summary,
        actorId: input.actorId ?? null,
        actorEmail: input.actorEmail ?? null,
        meta: input.meta,
      },
    });
  } catch (err) {
    console.error('[activity] failed to record', input.action, err);
  }
}

/** Fire-and-forget variant for hot paths that must not await the write. */
export function logActivityAsync(input: ActivityInput): void {
  void logActivity(input);
}

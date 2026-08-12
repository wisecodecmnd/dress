import { PrismaClient } from '@prisma/client';
import { env, isProd } from './env.js';

// Reuse one client across hot reloads in dev, or tsx watch exhausts connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: isProd ? ['error'] : ['warn', 'error'],
  });

if (env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

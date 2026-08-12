import { createApp } from './app.js';
import { env } from './config/env.js';
import { prisma } from './config/prisma.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.info(`[api] DENIMQUE API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
});

/** Finish in-flight requests and release the pool before exiting. */
async function shutdown(signal: string) {
  console.info(`[api] ${signal} received — shutting down`);

  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });

  // Don't hang forever if a connection refuses to close.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

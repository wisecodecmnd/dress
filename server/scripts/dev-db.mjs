/**
 * Local development Postgres.
 *
 * Runs a real PostgreSQL server from the `embedded-postgres` binaries so the
 * app can be developed and verified on a machine with no Postgres installed.
 * This is a development convenience only — it is a devDependency, it is never
 * imported by the API, and in production DATABASE_URL points at a managed
 * Postgres exactly as before.
 *
 *   node scripts/dev-db.mjs start   # initialise (first run) + run in foreground
 *   node scripts/dev-db.mjs stop
 *   node scripts/dev-db.mjs reset   # delete the cluster and start clean
 *
 * `start` stays in the foreground like any other dev server — Ctrl-C shuts the
 * cluster down cleanly. Run it in its own terminal alongside `npm run dev`.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const databaseDir = resolve(here, '../.pgdata');

const PORT = Number(process.env.DEV_DB_PORT ?? 55432);
const USER = process.env.DEV_DB_USER ?? 'postgres';
const PASSWORD = process.env.DEV_DB_PASSWORD ?? 'postgres';
const DB_NAME = process.env.DEV_DB_NAME ?? 'denimque';

const pg = new EmbeddedPostgres({
  databaseDir,
  user: USER,
  password: PASSWORD,
  port: PORT,
  persistent: true,
  // initdb otherwise inherits the Windows ANSI codepage (WIN1252), which
  // cannot store '₹'. Managed Postgres is UTF-8; the dev cluster must match.
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});

const url = `postgresql://${USER}:${PASSWORD}@localhost:${PORT}/${DB_NAME}?schema=public`;

async function start() {
  const fresh = !existsSync(databaseDir);
  if (fresh) {
    console.info('[dev-db] initialising cluster…');
    await pg.initialise();
  }

  await pg.start();

  // createDatabase throws if it already exists; that's the normal restart path.
  try {
    await pg.createDatabase(DB_NAME);
    console.info(`[dev-db] created database "${DB_NAME}"`);
  } catch {
    /* already there */
  }

  console.info(`[dev-db] ready on port ${PORT}`);
  console.info(`[dev-db] DATABASE_URL="${url}"`);
  console.info('[dev-db] leave this running; Ctrl-C to stop');
}

/**
 * embedded-postgres shuts the cluster down when this process exits, so the
 * script has to stay alive for the database to stay up. Nothing else keeps the
 * event loop busy once `start()` resolves.
 */
function keepAlive() {
  return new Promise(() => {
    // Resolved only by the signal handlers, which call process.exit.
  });
}

/** Ctrl-C / kill should stop the cluster, not orphan it. */
function trapSignals() {
  let closing = false;
  const shutdown = async (signal) => {
    if (closing) return;
    closing = true;
    console.info(`\n[dev-db] ${signal} — stopping cluster`);
    try {
      await pg.stop();
    } catch (err) {
      console.error('[dev-db] stop failed', err);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

async function stop() {
  await pg.stop();
  console.info('[dev-db] stopped');
}

const command = process.argv[2] ?? 'start';

try {
  if (command === 'start') {
    trapSignals();
    await start();
    await keepAlive();
  } else if (command === 'stop') {
    await stop();
  } else if (command === 'reset') {
    try {
      await pg.stop();
    } catch {
      /* wasn't running */
    }
    rmSync(databaseDir, { recursive: true, force: true });
    console.info('[dev-db] cluster deleted');
    trapSignals();
    await start();
    await keepAlive();
  } else {
    console.error(`[dev-db] unknown command "${command}" — use start | stop | reset`);
    process.exit(1);
  }
} catch (err) {
  console.error('[dev-db] failed', err);
  process.exit(1);
}

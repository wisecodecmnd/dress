/**
 * Runs a map of thunks with bounded concurrency and returns their results
 * keyed the same way.
 *
 * The dashboard needs ~30 independent aggregates. Firing them all at once
 * saturates the Prisma connection pool and the database starts refusing
 * connections, so they are run a few at a time instead — still concurrent,
 * but within the pool's budget.
 */
export async function runLimited<T extends Record<string, () => Promise<unknown>>>(
  tasks: T,
  limit = 5,
): Promise<{ [K in keyof T]: Awaited<ReturnType<T[K]>> }> {
  const entries = Object.entries(tasks);
  const results: Record<string, unknown> = {};
  let cursor = 0;

  async function worker() {
    while (cursor < entries.length) {
      const index = cursor++;
      const [key, thunk] = entries[index]!;
      results[key] = await thunk();
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, entries.length) }, () => worker()),
  );

  return results as { [K in keyof T]: Awaited<ReturnType<T[K]>> };
}

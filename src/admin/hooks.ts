import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Fetches a paged admin list and owns its query state (search, filters, page).
 *
 * Refetches whenever the query changes and, optionally, on an interval — the
 * stack has no realtime transport, so live views (carts, production board)
 * revalidate on a timer rather than pretending to be pushed.
 */
export interface ListQuery {
  q: string;
  page: number;
  pageSize: number;
  [key: string]: string | number | undefined;
}

export interface PagedResult<T> {
  items: T[];
  total: number;
  page: number;
  pageCount: number;
  pageSize: number;
}

/**
 * `R` is the whole response shape rather than just PagedResult, so endpoints
 * that return extra metadata alongside the page (e.g. the carts endpoint's
 * abandonment window) keep it typed.
 */
export function useAdminList<T, R extends PagedResult<T> = PagedResult<T>>(
  fetcher: (params: Record<string, unknown>) => Promise<R>,
  initial: Partial<ListQuery> = {},
  options: { refreshMs?: number } = {},
) {
  const [query, setQueryState] = useState<ListQuery>({
    q: '',
    page: 1,
    pageSize: 20,
    ...initial,
  } as ListQuery);

  const [data, setData] = useState<R | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Keep the fetcher out of the effect's dependency list — callers pass an
  // inline arrow, which would otherwise refetch on every render.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetcherRef
      .current(query)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [query, nonce]);

  // Background revalidation for live views.
  const refreshMs = options.refreshMs;
  useEffect(() => {
    if (!refreshMs) return;
    const id = window.setInterval(refresh, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs, refresh]);

  /** Any change other than the page itself resets to page 1. */
  const setQuery = useCallback((patch: Partial<ListQuery>) => {
    setQueryState((prev) => {
      const next = { ...prev, ...patch };
      if (!('page' in patch)) next.page = 1;
      return next;
    });
  }, []);

  return { query, setQuery, data, loading, error, refresh };
}

/** Fetches a single resource, with a manual refresh for after mutations. */
export function useAdminResource<T>(
  fetcher: () => Promise<T>,
  deps: unknown[] = [],
  options: { refreshMs?: number } = {},
) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [nonce, setNonce] = useState(0);
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const refreshMs = options.refreshMs;
  useEffect(() => {
    if (!refreshMs) return;
    const id = window.setInterval(refresh, refreshMs);
    return () => window.clearInterval(id);
  }, [refreshMs, refresh]);

  return { data, loading, error, refresh, setData };
}

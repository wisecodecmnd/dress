import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, NavLink, useParams, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { api } from '../services/api';
import ShopStage from '../components/shop/ShopStage';
import type { Category, Product } from '../types';

/** The carousel is a ring, so it can carry the whole catalogue in one pass. */
const PAGE_SIZE = 60;

export default function Shop() {
  const { category } = useParams();
  const [searchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<{ label: string; slug: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Bumped by the error state's retry, which re-runs the real fetch. */
  const [attempt, setAttempt] = useState(0);

  const sort = searchParams.get('sort') ?? 'newest';
  const active = category ?? '';

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  // Category navigation stays admin-managed: a category created in admin
  // appears here, and a disabled one disappears, with no code change.
  useEffect(() => {
    let cancelled = false;

    api
      .getCategories()
      .then((res) => {
        if (cancelled) return;
        setCategories(res.categories.map((c: Category) => ({ label: c.name, slug: c.slug })));
      })
      .catch(() => {
        // The carousel is what matters on this page; navigation degrades quietly.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // The single source of products: whatever the catalogue API returns, which is
  // whatever an admin has created and left active.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (category) params.set('category', category);
    params.set('sort', sort);
    params.set('limit', String(PAGE_SIZE));

    api
      .getProducts(params.toString())
      .then((res) => {
        if (!cancelled) setProducts(res.products);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not load the collection');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category, sort, attempt]);

  // An admin publishing or deactivating a piece in another tab shows up as soon
  // as the customer comes back to this one.
  useEffect(() => {
    const onFocus = () => {
      if (document.visibilityState === 'visible') retry();
    };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [retry]);

  const categoryName = categories.find((c) => c.slug === active)?.label;
  const heading = categoryName ?? 'The Collection';
  const headline = (categoryName ?? 'New\nCollection').toUpperCase();

  return (
    <>
      <Helmet>
        <title>{`${heading} — DENIMQUE`}</title>
        <meta
          name="description"
          content="Shop the DENIMQUE collection: selvedge jeans, jackets, shirts, overshirts and numbered limited editions."
        />
        <link rel="canonical" href={`https://denimque.com/shop${active ? `/${active}` : ''}`} />
      </Helmet>

      {/* Category navigation sits above the stage as a thin editorial rail so
          the /shop/:category routes stay reachable without a filter chrome. */}
      {categories.length > 0 && (
        <nav
          className="absolute inset-x-0 top-[4.5rem] z-40 flex justify-center gap-x-6 gap-y-2 overflow-x-auto px-6 pt-3 no-scrollbar lg:top-[4.75rem] lg:px-12"
          aria-label="Product categories"
        >
          <NavLink
            to="/shop"
            end
            className={({ isActive }) =>
              `whitespace-nowrap text-meta uppercase transition-colors ${
                isActive ? 'text-pearl' : 'text-fog hover:text-pearl'
              }`
            }
          >
            All
          </NavLink>
          {categories.map((c) => (
            <NavLink
              key={c.slug}
              to={`/shop/${c.slug}`}
              className={({ isActive }) =>
                `whitespace-nowrap text-meta uppercase transition-colors ${
                  isActive ? 'text-pearl' : 'text-fog hover:text-pearl'
                }`
              }
            >
              {c.label}
            </NavLink>
          ))}
        </nav>
      )}

      {loading ? (
        <StageMessage
          kicker="DENIMQUE"
          headline={'LOADING\nCOLLECTION'}
          title="Loading collection…"
          body="Pulling the current pieces from the atelier."
          pulse
        />
      ) : error ? (
        <StageMessage
          kicker="DENIMQUE"
          headline={'UNABLE\nTO LOAD'}
          title="Unable to load collection"
          body={error}
          action={
            <button
              type="button"
              onClick={retry}
              className="border border-pearl bg-pearl px-7 py-3.5 text-meta uppercase text-obsidian transition-colors hover:border-denim hover:bg-denim"
            >
              Try again
            </button>
          }
        />
      ) : products.length === 0 ? (
        <StageMessage
          kicker="DENIMQUE"
          headline={'COMING\nSOON'}
          title="Collection coming soon"
          body={
            active
              ? 'No pieces are currently available in this category.'
              : 'No products are currently available.'
          }
          action={
            active ? (
              <Link
                to="/shop"
                className="border border-stone/50 px-7 py-3.5 text-meta uppercase text-mist transition-colors hover:border-pearl hover:text-pearl"
              >
                View everything
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ShopStage products={products} headline={headline} kicker="Shop DENIMQUE" />
      )}
    </>
  );
}

/**
 * Loading, empty and error all keep the stage: same full viewport, same ghost
 * headline, same bottom-left copy block. The page never flashes a bare grid.
 */
function StageMessage({
  kicker,
  headline,
  title,
  body,
  action,
  pulse = false,
}: {
  kicker: string;
  headline: string;
  title: string;
  body?: string;
  action?: ReactNode;
  pulse?: boolean;
}) {
  return (
    <section className="relative flex min-h-[100svh] w-full items-end overflow-hidden bg-obsidian">
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(78% 62% at 50% 46%, rgba(38,55,74,0.55) 0%, rgba(10,10,11,0) 78%)',
        }}
      />
      <div aria-hidden="true" className="grain absolute inset-0 z-[5]" />

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-6 pt-28 lg:px-12 lg:pt-32">
        <span className="block text-meta uppercase text-denim">{kicker}</span>
      </div>

      <h1
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-[19%] z-10 select-none whitespace-pre-line px-4 text-center font-poster uppercase leading-[0.82] text-pearl/[0.07] md:top-[16%] ${
          pulse ? 'animate-pulse' : ''
        }`}
        style={{ fontSize: 'clamp(2.75rem, 13vw, 13rem)' }}
      >
        {headline}
      </h1>

      <div className="relative z-30 w-full px-6 pb-14 lg:px-12 lg:pb-16">
        <div className="mx-auto max-w-[110rem]">
          <p className="font-display text-3xl text-pearl lg:text-[2.6rem]">{title}</p>
          {body && <p className="mt-3 max-w-md text-sm text-mist">{body}</p>}
          {action && <div className="mt-6">{action}</div>}
        </div>
      </div>
    </section>
  );
}

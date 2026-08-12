import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { api } from '../services/api';
import ProductCard from '../components/products/ProductCard';
import QuickView from '../components/products/QuickView';
import { useUIStore } from '../store/uiStore';
import type { Product } from '../types';

const categories = [
  { label: 'All', slug: '' },
  { label: 'Jeans', slug: 'jeans' },
  { label: 'Jackets', slug: 'jackets' },
  { label: 'Shirts', slug: 'shirts' },
  { label: 'Overshirts', slug: 'overshirts' },
  { label: 'Limited Editions', slug: 'limited-editions' },
];

const sorts = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-asc', label: 'Price: Low to High' },
  { value: 'price-desc', label: 'Price: High to Low' },
];

/**
 * Editorial asymmetric grid on desktop: every 5th and 6th card takes a taller
 * frame and spans wider, so the page never reads as a uniform Shopify grid.
 * Mobile falls back to a clean single column.
 */
const spanFor = (i: number) => {
  const slot = i % 6;
  if (slot === 0) return 'lg:col-span-7';
  if (slot === 1) return 'lg:col-span-5 lg:pt-16';
  if (slot === 2) return 'lg:col-span-4';
  if (slot === 3) return 'lg:col-span-4 lg:pt-20';
  if (slot === 4) return 'lg:col-span-4';
  return 'lg:col-span-12 lg:mx-auto lg:max-w-3xl';
};

export default function Shop() {
  const { category } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quickView, setQuickView] = useState<Product | null>(null);
  const showToast = useUIStore((s) => s.showToast);

  const sort = searchParams.get('sort') ?? 'newest';
  const active = category ?? '';

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (category) params.set('category', category);
    params.set('sort', sort);

    api
      .getProducts(params.toString())
      .then((res) => {
        if (!cancelled) setProducts(res.products);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : 'Could not load the collection';
        setError(message);
        showToast(message, 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [category, sort, showToast]);

  const heading = categories.find((c) => c.slug === active)?.label ?? 'The Collection';

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

      <div className="px-6 pb-24 pt-32 lg:px-12 lg:pt-40">
        <div className="mx-auto max-w-[110rem]">
          <header className="mb-14">
            <span className="mb-4 block text-meta uppercase text-denim">Shop Denimque</span>
            <h1 className="font-display text-display-lg">{heading}</h1>
          </header>

          {/* Filters */}
          <div className="mb-14 flex flex-col items-start justify-between gap-6 border-b border-stone/30 pb-6 lg:flex-row lg:items-center">
            <nav className="flex flex-wrap gap-x-7 gap-y-3" aria-label="Product categories">
              {categories.map((cat) => (
                <Link
                  key={cat.slug || 'all'}
                  to={cat.slug ? `/shop/${cat.slug}` : '/shop'}
                  aria-current={active === cat.slug ? 'page' : undefined}
                  className={`text-meta uppercase transition-colors ${
                    active === cat.slug
                      ? 'border-b border-pearl pb-1 text-pearl'
                      : 'text-fog hover:text-pearl'
                  }`}
                >
                  {cat.label}
                </Link>
              ))}
            </nav>

            <label className="flex items-center gap-3 text-meta uppercase text-fog">
              Sort
              <select
                value={sort}
                onChange={(e) => {
                  const next = new URLSearchParams(searchParams);
                  next.set('sort', e.target.value);
                  setSearchParams(next, { replace: true });
                }}
                className="border border-stone/50 bg-transparent px-3 py-2 text-sm normal-case tracking-normal text-pearl outline-none transition-colors focus:border-denim"
              >
                {sorts.map((s) => (
                  <option key={s.value} value={s.value} className="bg-charcoal">
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Grid */}
          {loading ? (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="aspect-[3/4] animate-pulse bg-charcoal" />
              ))}
            </div>
          ) : error ? (
            <div className="py-24 text-center">
              <p className="font-display text-2xl text-mist">The collection didn't load</p>
              <p className="mt-2 text-sm text-fog">{error}</p>
              <button
                onClick={() => setSearchParams(new URLSearchParams({ sort }), { replace: true })}
                className="mt-6 border border-stone/50 px-6 py-3 text-meta uppercase text-mist hover:border-pearl hover:text-pearl"
              >
                Try again
              </button>
            </div>
          ) : products.length === 0 ? (
            <div className="py-24 text-center">
              <p className="font-display text-2xl text-mist">Nothing in this category yet</p>
              <Link to="/shop" className="mt-3 inline-block text-meta uppercase text-denim link-underline">
                View everything
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-12 lg:gap-x-8 lg:gap-y-20">
              {products.map((p, i) => (
                <div key={p.id} className={spanFor(i)}>
                  <ProductCard
                    product={p}
                    index={i}
                    onQuickView={setQuickView}
                    aspect={i % 6 === 0 ? 'tall' : 'standard'}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <QuickView product={quickView} onClose={() => setQuickView(null)} />
    </>
  );
}

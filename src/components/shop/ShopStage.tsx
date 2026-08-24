import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { useUIStore } from '../../store/uiStore';
import { formatPrice } from '../../utils/format';
import { dominantColor, fallbackTone } from '../../utils/imageColor';
import { media } from '../../assets/media';
import type { Product } from '../../types';

/** One coordinated move: position, scale, blur, opacity and backdrop all share it. */
const MOVE_MS = 650;

interface ShopStageProps {
  /** Live, admin-managed catalogue. Order and contents come from the API. */
  products: Product[];
  /** Giant ghost headline — the active category name, or the collection default. */
  headline: string;
  /** Small eyebrow above the headline. */
  kicker: string;
}

type Slot = { x: number; scale: number; blur: number; opacity: number; z: number };

/**
 * Where a product sits relative to the active one. `d` is the signed, wrapped
 * distance, so the same table serves 2 products and 50.
 */
const slotFor = (d: number, compact: boolean): Slot => {
  if (d === 0) return { x: 0, scale: 1, blur: 0, opacity: 1, z: 30 };

  if (Math.abs(d) === 1) {
    return compact
      ? { x: d * 44, scale: 0.34, blur: 5, opacity: 0.34, z: 20 }
      : { x: d * 37, scale: 0.47, blur: 6, opacity: 0.42, z: 20 };
  }

  // Parked off-stage: mounted so the move into a side slot is a transition
  // rather than a pop-in.
  return { x: Math.sign(d) * (compact ? 66 : 58), scale: 0.24, blur: 11, opacity: 0, z: 10 };
};

const COMPACT_QUERY = '(max-width: 767px)';

export default function ShopStage({ products, headline, kicker }: ShopStageProps) {
  const total = products.length;
  const [index, setIndex] = useState(0);
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(COMPACT_QUERY).matches,
  );

  const addItem = useCartStore((s) => s.addItem);
  const openCart = useUIStore((s) => s.openCart);
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    const mq = window.matchMedia(COMPACT_QUERY);
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // The catalogue can shrink under us — an admin deactivating a product is the
  // normal case, not an edge case.
  useEffect(() => {
    setIndex((i) => (total === 0 ? 0 : Math.min(i, total - 1)));
  }, [total]);

  const safeIndex = total === 0 ? 0 : Math.min(index, total - 1);
  const active = products[safeIndex];

  const go = useCallback(
    (dir: number) => {
      if (total < 2) return;
      setIndex((i) => (i + dir + total) % total);
    },
    [total],
  );

  // ── Backdrop: taken from the active garment's own image ───────────────────
  const activeImage = active?.images?.[0]?.url;
  const [tint, setTint] = useState(() => (active ? fallbackTone(active.id) : BRAND_BASE));

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const seedTone = fallbackTone(active.id);

    if (!activeImage) {
      setTint(seedTone);
      return;
    }

    void dominantColor(activeImage).then((colour) => {
      if (!cancelled) setTint(colour ?? seedTone);
    });

    return () => {
      cancelled = true;
    };
  }, [active, activeImage]);

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  // ── Swipe ─────────────────────────────────────────────────────────────────
  const dragStart = useRef<number | null>(null);
  const onPointerDown = (e: ReactPointerEvent) => {
    dragStart.current = e.clientX;
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const from = dragStart.current;
    dragStart.current = null;
    if (from === null) return;
    const dx = e.clientX - from;
    if (Math.abs(dx) > 44) go(dx < 0 ? 1 : -1);
  };

  // A garment the admin hasn't shot yet — or an image URL that no longer
  // resolves — gets an editorial placeholder rather than a broken-image icon
  // and a headline-sized alt string in the middle of the stage.
  const [brokenImages, setBrokenImages] = useState<Record<string, true>>({});
  const markBroken = useCallback(
    (id: string) => setBrokenImages((prev) => (prev[id] ? prev : { ...prev, [id]: true })),
    [],
  );

  // ── Size + add to cart ────────────────────────────────────────────────────
  const stockFor = useCallback(
    (size: string) =>
      active?.inventory?.find((i) => i.size === size)?.quantity ?? Number.POSITIVE_INFINITY,
    [active],
  );

  const sizes = active?.sizes ?? [];
  const firstInStock = useMemo(
    () => sizes.find((s) => stockFor(s.size) > 0)?.size ?? sizes[0]?.size ?? 'M',
    [sizes, stockFor],
  );

  const [size, setSize] = useState(firstInStock);
  const [cartState, setCartState] = useState<'idle' | 'adding' | 'added'>('idle');

  // A new garment in the centre means a new size list and a fresh button.
  useEffect(() => {
    setSize(firstInStock);
    setCartState('idle');
  }, [active?.id, firstInStock]);

  const confirmTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  const handleAddToCart = () => {
    if (!active || cartState !== 'idle') return;

    if (stockFor(size) < 1) {
      showToast(`Size ${size} is sold out`, 'error');
      return;
    }

    setCartState('adding');
    addItem(active.id, size, 1, active);

    // Confirmed against the cart store, so the button never reports a success
    // the cart didn't actually record.
    const landed = useCartStore
      .getState()
      .items.some((i) => i.productId === active.id && i.size === size);

    if (confirmTimer.current) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => {
      if (!landed) {
        setCartState('idle');
        showToast('That piece could not be added', 'error');
        return;
      }
      setCartState('added');
      showToast(`${active.name} · size ${size} added`, 'success');
      openCart();
      confirmTimer.current = window.setTimeout(() => setCartState('idle'), 2200);
    }, 220);
  };

  if (!active) return null;

  const cartLabel =
    cartState === 'adding' ? 'Adding…' : cartState === 'added' ? 'Added to cart' : 'Add to cart';

  return (
    <section
      className="relative min-h-[100svh] w-full overflow-hidden bg-obsidian"
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      aria-roledescription="carousel"
      aria-label="Collection"
    >
      {/* ── Backdrop: a single tinted wash, masked to a soft pool of light.
             Transitioning background-color (rather than a gradient) is what lets
             the relight ride the same 650ms curve as the carousel. ── */}
      <div
        aria-hidden="true"
        className="absolute inset-0 z-0 transition-colors ease-editorial"
        style={{
          backgroundColor: tint,
          transitionDuration: `${MOVE_MS}ms`,
          opacity: 0.55,
          maskImage: LIGHT_POOL,
          WebkitMaskImage: LIGHT_POOL,
        }}
      />
      <div aria-hidden="true" className="vignette absolute inset-0 z-0" />
      <div aria-hidden="true" className="grain absolute inset-0 z-[5]" />

      {/* ── Eyebrow + giant ghost headline ── */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 px-6 pt-28 lg:px-12 lg:pt-32">
        <span className="block text-meta uppercase text-denim">{kicker}</span>
      </div>

      <h1
        className="pointer-events-none absolute inset-x-0 top-[19%] z-10 select-none whitespace-pre-line px-4 text-center font-poster uppercase leading-[0.82] tracking-[-0.01em] text-pearl/[0.07] md:top-[16%]"
        style={{ fontSize: 'clamp(2.75rem, 13vw, 13rem)' }}
      >
        {headline}
      </h1>

      {/* ── Carousel ── */}
      <div className="absolute inset-x-0 top-[13vh] bottom-[45vh] z-20 md:top-[17vh] md:bottom-[24vh]">
        {products.map((product, i) => {
          let d = i - safeIndex;

          // Wrap to the shortest signed distance so the carousel is a ring.
          // Skipped at two items, where there is no shorter way round and the
          // neighbour should simply stay put on one side.
          if (total > 2) {
            const half = Math.floor(total / 2);
            if (d > half) d -= total;
            else if (d < -half) d += total;
          }

          // Only the centre, its neighbours and the next ring are worth
          // mounting; a 50-product catalogue must not mean 50 images.
          if (Math.abs(d) > 2) return null;

          const slot = slotFor(d, compact);
          const image = product.images?.[0]?.url ?? media.productFallback;
          const isActive = d === 0;
          const shot = brokenImages[product.id] ? null : image;

          return (
            <button
              key={product.id}
              type="button"
              onClick={() => (isActive ? undefined : setIndex(i))}
              tabIndex={isActive ? -1 : 0}
              aria-hidden={slot.opacity === 0 ? true : undefined}
              aria-label={isActive ? undefined : `Show ${product.name}`}
              className={`absolute inset-0 flex items-end justify-center transition-all ease-editorial ${
                isActive ? 'cursor-default' : 'cursor-pointer'
              }`}
              style={{
                transitionDuration: `${MOVE_MS}ms`,
                transform: `translate3d(${slot.x}%, 0, 0) scale(${slot.scale})`,
                transformOrigin: 'bottom center',
                filter: slot.blur ? `blur(${slot.blur}px)` : 'none',
                opacity: slot.opacity,
                zIndex: slot.z,
                pointerEvents: slot.opacity === 0 ? 'none' : 'auto',
              }}
            >
              {shot ? (
                <img
                  src={shot}
                  alt={isActive ? product.name : ''}
                  aria-hidden={isActive ? undefined : true}
                  loading={Math.abs(d) <= 1 ? 'eager' : 'lazy'}
                  decoding="async"
                  draggable={false}
                  onError={() => markBroken(product.id)}
                  className="h-full w-full bg-transparent object-contain object-bottom drop-shadow-[0_40px_80px_rgba(0,0,0,0.55)]"
                />
              ) : (
                <div
                  aria-hidden="true"
                  className="flex h-full w-[64%] max-w-[34rem] items-end justify-center border border-pearl/10 bg-pearl/[0.02] pb-[12%]"
                >
                  <span className="px-6 text-center text-meta uppercase text-fog">
                    Photography coming soon
                  </span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Grounds the copy against the garment's hem on phones, where the two are
          unavoidably close. Desktop has room to spare, so no scrim is laid over
          the garment there. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 z-[25] h-[52vh] bg-gradient-to-t from-obsidian via-obsidian/80 to-transparent md:hidden"
      />

      {/* ── Bottom bar: information, navigation, CTA ── */}
      <div className="absolute inset-x-0 bottom-0 z-30 px-6 pb-8 lg:px-12 lg:pb-10">
        <div className="mx-auto flex max-w-[110rem] flex-col gap-5 lg:flex-row lg:items-end lg:justify-between lg:gap-12">
          {/* Bottom-left: the active garment */}
          <div className="max-w-md">
            <div key={active.id} className="animate-fade-up" aria-live="polite">
              {active.category && (
                <span className="mb-2 block text-meta uppercase text-fog">
                  {active.category.name}
                </span>
              )}

              <h2 className="font-display text-[1.75rem] leading-tight text-pearl md:text-3xl lg:text-[2.6rem]">
                <Link to={`/product/${active.slug}`} className="link-underline">
                  {active.name}
                </Link>
              </h2>

              <p className="mt-2 line-clamp-2 text-sm text-mist">{active.description}</p>

              <p className="mt-3 text-lg text-pearl">
                {formatPrice(active.price, active.currency)}
              </p>
            </div>

            {sizes.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Size">
                {sizes.map((s) => {
                  const soldOut = stockFor(s.size) < 1;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => !soldOut && setSize(s.size)}
                      disabled={soldOut}
                      aria-pressed={size === s.size}
                      className={`h-8 w-8 border text-[11px] transition-colors ${
                        size === s.size
                          ? 'border-pearl text-pearl'
                          : soldOut
                            ? 'cursor-not-allowed border-stone/30 text-stone line-through'
                            : 'border-stone/50 text-fog hover:border-pearl/60'
                      }`}
                    >
                      {s.size}
                    </button>
                  );
                })}
              </div>
            )}

            <div className="mt-5 flex items-center gap-4">
              <button
                type="button"
                onClick={handleAddToCart}
                disabled={cartState !== 'idle'}
                className={`min-w-[13rem] border px-7 py-3.5 text-meta uppercase transition-all duration-500 ease-editorial ${
                  cartState === 'added'
                    ? 'border-denim bg-denim text-obsidian'
                    : 'border-pearl bg-pearl text-obsidian hover:border-denim hover:bg-denim hover:text-obsidian'
                } ${cartState === 'adding' ? 'opacity-70' : ''}`}
              >
                {cartLabel}
              </button>

              {total > 1 && (
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => go(-1)}
                    aria-label="Previous piece"
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-pearl/25 bg-pearl/[0.04] text-mist backdrop-blur-sm transition-all duration-500 ease-editorial hover:scale-110 hover:border-pearl/60 hover:text-pearl lg:h-14 lg:w-14"
                  >
                    <ArrowLeft size={18} strokeWidth={1.25} />
                  </button>
                  <button
                    type="button"
                    onClick={() => go(1)}
                    aria-label="Next piece"
                    className="flex h-12 w-12 items-center justify-center rounded-full border border-pearl/25 bg-pearl/[0.04] text-mist backdrop-blur-sm transition-all duration-500 ease-editorial hover:scale-110 hover:border-pearl/60 hover:text-pearl lg:h-14 lg:w-14"
                  >
                    <ArrowRight size={18} strokeWidth={1.25} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Bottom-right: editorial CTA into the active piece */}
          <div className="flex items-end justify-between gap-6 lg:justify-end">
            {total > 1 && (
              <span className="text-meta uppercase text-fog lg:hidden">
                {safeIndex + 1} / {total}
              </span>
            )}

            <Link
              to={`/product/${active.slug}`}
              className="group flex items-baseline gap-3 font-display text-2xl uppercase tracking-[0.06em] text-pearl transition-colors hover:text-denim md:text-3xl lg:text-[3.4rem]"
            >
              Shop now
              <ArrowUpRight
                size={compact ? 22 : 34}
                strokeWidth={1}
                className="transition-transform duration-500 ease-editorial group-hover:translate-x-1 group-hover:-translate-y-1"
              />
            </Link>
          </div>
        </div>
      </div>

      {/* Desktop position readout, kept clear of the copy */}
      {total > 1 && (
        <span className="absolute right-6 top-24 z-30 hidden text-meta uppercase text-fog lg:right-12 lg:top-32 lg:block">
          {String(safeIndex + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </span>
      )}
    </section>
  );
}

/** Base wash used before a product's own tone is known. */
const BRAND_BASE = '#26374A';

/** Keeps the tint a pool of light behind the garment instead of a flat field. */
const LIGHT_POOL =
  'radial-gradient(78% 62% at 50% 46%, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.55) 48%, transparent 78%)';

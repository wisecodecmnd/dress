import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft, Check, Heart, RotateCcw, Ruler, ShoppingBag, Truck } from 'lucide-react';
import { api } from '../services/api';
import { useCartStore } from '../store/cartStore';
import { useWishlistStore } from '../store/wishlistStore';
import { useUIStore } from '../store/uiStore';
import Reveal from '../components/ui/Reveal';
import { formatPrice } from '../utils/format';
import { media } from '../assets/media';
import type { Product as ProductType } from '../types';

const TABS = [
  { id: 'story', label: 'The Story' },
  { id: 'fabric', label: 'Fabric' },
  { id: 'fit', label: 'Fit' },
  { id: 'care', label: 'Care' },
] as const;

type TabId = (typeof TABS)[number]['id'];

export default function Product() {
  const { slug } = useParams();
  const navigate = useNavigate();

  const [product, setProduct] = useState<ProductType | null>(null);
  const [loading, setLoading] = useState(true);
  const [size, setSize] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [tab, setTab] = useState<TabId>('story');
  const [sizeGuideOpen, setSizeGuideOpen] = useState(false);

  const addItem = useCartStore((s) => s.addItem);
  const openCart = useUIStore((s) => s.openCart);
  const showToast = useUIStore((s) => s.showToast);
  const { items: wishlistItems, addItem: addToWishlist, removeItem: removeFromWishlist } =
    useWishlistStore();

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    setLoading(true);

    api
      .getProduct(slug)
      .then((res) => {
        if (cancelled) return;
        setProduct(res.product);
        setSize(res.product.sizes?.[0]?.size ?? '');
        setActiveImage(0);
        setQuantity(1);
      })
      .catch(() => {
        if (cancelled) return;
        showToast('That piece is no longer available', 'error');
        navigate('/shop', { replace: true });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [slug, navigate, showToast]);

  const wished = product ? wishlistItems.find((w) => w.productId === product.id) : undefined;
  const stockFor = (s: string) =>
    product?.inventory?.find((i) => i.size === s)?.quantity ?? Number.POSITIVE_INFINITY;

  const handleAdd = (thenCheckout = false) => {
    if (!product) return;
    if (!size) {
      showToast('Select a size first', 'error');
      return;
    }
    if (stockFor(size) < quantity) {
      showToast(`Only ${stockFor(size)} left in size ${size}`, 'error');
      return;
    }

    addItem(product.id, size, quantity, product);

    if (thenCheckout) navigate('/checkout');
    else {
      showToast('Added to cart', 'success');
      openCart();
    }
  };

  const handleWishlist = () => {
    if (!product) return;
    if (wished) {
      removeFromWishlist(wished.id);
      showToast('Removed from wishlist', 'info');
    } else {
      addToWishlist(product.id, product);
      showToast('Saved to wishlist', 'success');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen px-6 pt-32 lg:px-12 lg:pt-40">
        <div className="mx-auto grid max-w-[110rem] grid-cols-1 gap-12 lg:grid-cols-2">
          <div className="aspect-[3/4] animate-pulse bg-charcoal" />
          <div className="space-y-4">
            <div className="h-10 w-3/4 animate-pulse bg-charcoal" />
            <div className="h-5 w-1/4 animate-pulse bg-charcoal" />
            <div className="h-32 animate-pulse bg-charcoal" />
          </div>
        </div>
      </div>
    );
  }

  if (!product) return null;

  const images = product.images?.length ? product.images : null;
  const heroImage = images?.[activeImage]?.url ?? media.productFallback;
  const tabCopy: Record<TabId, string | null | undefined> = {
    story: product.story ?? product.description,
    fabric: product.fabric,
    fit: product.fit,
    care: product.care,
  };

  return (
    <>
      <Helmet>
        <title>{`${product.name} — DENIMQUE`}</title>
        <meta name="description" content={product.description.slice(0, 158)} />
        <link rel="canonical" href={`https://denimque.com/product/${product.slug}`} />
        <meta property="og:type" content="product" />
        <meta property="og:title" content={`${product.name} — DENIMQUE`} />
        <meta property="og:image" content={heroImage} />
        {/* Product + breadcrumb structured data for rich results */}
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: product.name,
            description: product.description,
            image: images?.map((i) => i.url) ?? [heroImage],
            brand: { '@type': 'Brand', name: 'DENIMQUE' },
            category: product.category?.name,
            color: product.color ?? undefined,
            offers: {
              '@type': 'Offer',
              price: Number(product.price),
              priceCurrency: product.currency,
              availability: 'https://schema.org/InStock',
              url: `https://denimque.com/product/${product.slug}`,
            },
          })}
        </script>
        <script type="application/ld+json">
          {JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'BreadcrumbList',
            itemListElement: [
              { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://denimque.com/' },
              { '@type': 'ListItem', position: 2, name: 'Shop', item: 'https://denimque.com/shop' },
              {
                '@type': 'ListItem',
                position: 3,
                name: product.name,
                item: `https://denimque.com/product/${product.slug}`,
              },
            ],
          })}
        </script>
      </Helmet>

      <div className="px-6 pb-24 pt-28 lg:px-12 lg:pt-36">
        <div className="mx-auto max-w-[110rem]">
          <button
            onClick={() => navigate(-1)}
            className="mb-8 flex items-center gap-2 text-sm text-fog transition-colors hover:text-pearl"
          >
            <ArrowLeft size={15} /> Back
          </button>

          <div className="grid grid-cols-1 gap-12 lg:grid-cols-2 lg:gap-20">
            {/* Gallery */}
            <div className="space-y-4">
              <div className="aspect-[3/4] overflow-hidden bg-charcoal">
                <img
                  src={heroImage}
                  alt={images?.[activeImage]?.alt ?? product.name}
                  className="h-full w-full object-cover"
                  decoding="async"
                />
              </div>

              {images && images.length > 1 && (
                <div className="flex gap-3" role="tablist" aria-label="Product images">
                  {images.map((img, i) => (
                    <button
                      key={img.id}
                      role="tab"
                      aria-selected={activeImage === i}
                      aria-label={`View image ${i + 1}`}
                      onClick={() => setActiveImage(i)}
                      className={`h-24 w-20 overflow-hidden border-2 transition-colors ${
                        activeImage === i ? 'border-pearl' : 'border-transparent hover:border-stone'
                      }`}
                    >
                      <img
                        src={img.url}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="lg:pt-6">
              {product.isLimited && (
                <span className="mb-4 block text-meta uppercase text-denim">
                  Limited Edition{product.editionNo ? ` · No. ${product.editionNo}` : ''}
                </span>
              )}

              <h1 className="mb-4 font-display text-display-md">{product.name}</h1>

              <div className="mb-6 flex items-center gap-4">
                <span className="font-display text-2xl">
                  {formatPrice(product.price, product.currency)}
                </span>
                {product.comparePrice && (
                  <span className="text-fog line-through">
                    {formatPrice(product.comparePrice, product.currency)}
                  </span>
                )}
              </div>

              <p className="mb-8 text-body-lg leading-relaxed text-mist">{product.description}</p>

              {product.color && (
                <div className="mb-8">
                  <span className="mb-2 block text-meta uppercase text-fog">Colour</span>
                  <span className="text-sm text-mist">{product.color}</span>
                </div>
              )}

              {/* Size */}
              <div className="mb-8">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-meta uppercase text-fog">Select Size</span>
                  <button
                    onClick={() => setSizeGuideOpen((o) => !o)}
                    aria-expanded={sizeGuideOpen}
                    className="flex items-center gap-1 text-xs text-fog underline transition-colors hover:text-pearl"
                  >
                    <Ruler size={12} /> Size Guide
                  </button>
                </div>

                <div className="flex flex-wrap gap-3">
                  {product.sizes?.map((s) => {
                    const stock = stockFor(s.size);
                    const soldOut = stock < 1;
                    return (
                      <button
                        key={s.id}
                        onClick={() => !soldOut && setSize(s.size)}
                        disabled={soldOut}
                        aria-pressed={size === s.size}
                        className={`h-12 w-12 border text-sm transition-all ${
                          size === s.size
                            ? 'border-pearl bg-pearl/10 text-pearl'
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

                {sizeGuideOpen && (
                  <table className="mt-4 w-full border border-stone/30 text-left text-xs text-mist">
                    <thead className="bg-charcoal text-fog">
                      <tr>
                        <th className="px-3 py-2 font-normal uppercase tracking-widest">Size</th>
                        <th className="px-3 py-2 font-normal uppercase tracking-widest">Waist</th>
                        <th className="px-3 py-2 font-normal uppercase tracking-widest">Inseam</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        ['28', '71 cm', '81 cm'],
                        ['30', '76 cm', '81 cm'],
                        ['32', '81 cm', '83 cm'],
                        ['34', '86 cm', '83 cm'],
                        ['36', '91 cm', '84 cm'],
                      ].map((row) => (
                        <tr key={row[0]} className="border-t border-stone/20">
                          {row.map((cell) => (
                            <td key={cell} className="px-3 py-2">
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Quantity */}
              <div className="mb-8">
                <span className="mb-2 block text-meta uppercase text-fog">Quantity</span>
                <div className="flex w-32 items-center justify-between border border-stone/50">
                  <button
                    onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    className="px-4 py-3 text-mist hover:text-pearl"
                    aria-label="Decrease quantity"
                  >
                    −
                  </button>
                  <span className="tabular-nums text-sm">{quantity}</span>
                  <button
                    onClick={() => setQuantity((q) => q + 1)}
                    className="px-4 py-3 text-mist hover:text-pearl"
                    aria-label="Increase quantity"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div className="mb-10 flex flex-wrap gap-4">
                <button
                  onClick={() => handleAdd(false)}
                  className="flex flex-1 items-center justify-center gap-2 bg-pearl py-4 text-sm uppercase tracking-[0.18em] text-obsidian transition-colors hover:bg-white"
                >
                  <ShoppingBag size={16} /> Add to Cart
                </button>
                <button
                  onClick={() => handleAdd(true)}
                  className="flex-1 border border-pearl py-4 text-sm uppercase tracking-[0.18em] text-pearl transition-colors hover:bg-pearl hover:text-obsidian"
                >
                  Buy Now
                </button>
                <button
                  onClick={handleWishlist}
                  aria-pressed={Boolean(wished)}
                  aria-label={wished ? 'Remove from wishlist' : 'Save to wishlist'}
                  className={`flex h-14 w-14 items-center justify-center border transition-colors ${
                    wished ? 'border-denim text-denim' : 'border-stone/50 text-fog hover:border-pearl'
                  }`}
                >
                  <Heart size={18} fill={wished ? 'currentColor' : 'none'} />
                </button>
              </div>

              {/* Trust */}
              <div className="mb-10 grid grid-cols-3 gap-4 border-y border-stone/30 py-6">
                {[
                  { Icon: Truck, label: 'Free express shipping' },
                  { Icon: RotateCcw, label: '30-day returns' },
                  { Icon: Check, label: 'Authenticity guaranteed' },
                ].map(({ Icon, label }) => (
                  <div key={label} className="text-center">
                    <Icon size={19} className="mx-auto mb-2 text-denim" />
                    <span className="text-xs text-fog">{label}</span>
                  </div>
                ))}
              </div>

              {/* Detail tabs */}
              <div>
                <div className="flex gap-6 border-b border-stone/30" role="tablist">
                  {TABS.map((t) => (
                    <button
                      key={t.id}
                      role="tab"
                      aria-selected={tab === t.id}
                      onClick={() => setTab(t.id)}
                      className={`pb-3 text-meta uppercase transition-colors ${
                        tab === t.id ? 'border-b border-pearl text-pearl' : 'text-fog hover:text-pearl'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
                <div className="pt-6 leading-relaxed text-mist">
                  {tabCopy[tab] ?? 'Details for this piece are being finalised.'}
                </div>
              </div>
            </div>
          </div>

          {/* Image-led storytelling below the fold */}
          <section className="mt-32 space-y-24">
            <Reveal className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
              <div className="aspect-[4/5] overflow-hidden">
                <img
                  src={images?.[1]?.url ?? media.fabricPortrait}
                  alt="Close detail of the selvedge weave"
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div>
                <span className="mb-4 block text-meta uppercase text-denim">The Fabric</span>
                <h2 className="mb-6 font-display text-display-md">Read it by touch.</h2>
                <p className="text-body-lg leading-relaxed text-mist">
                  {product.fabric ??
                    'Shuttle-woven selvedge with an irregular surface that catches light differently as it ages. Matte where the world expects shine.'}
                </p>
              </div>
            </Reveal>

            <Reveal className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
              <div className="order-2 lg:order-1">
                <span className="mb-4 block text-meta uppercase text-denim">Shipping</span>
                <h2 className="mb-6 font-display text-display-md">Sent in a single box.</h2>
                <p className="text-body-lg leading-relaxed text-mist">
                  {product.shipping ??
                    'Dispatched within 48 hours from Biella, insured and carbon-offset. Free express shipping on orders above ₹10,000.'}
                </p>
                <Link
                  to="/customize"
                  className="mt-8 inline-block border border-pearl/40 px-8 py-4 text-meta uppercase text-pearl transition-colors hover:bg-pearl hover:text-obsidian"
                >
                  Make this yours
                </Link>
              </div>
              <div className="order-1 aspect-[4/5] overflow-hidden lg:order-2">
                <img
                  src={images?.[2]?.url ?? media.craftPortrait}
                  alt="The garment being finished by hand"
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
            </Reveal>
          </section>
        </div>
      </div>
    </>
  );
}

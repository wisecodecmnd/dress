import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, Heart, ShoppingBag } from 'lucide-react';
import { useCartStore } from '../../store/cartStore';
import { useWishlistStore } from '../../store/wishlistStore';
import { useUIStore } from '../../store/uiStore';
import { formatPrice } from '../../utils/format';
import { media } from '../../assets/media';
import type { Product } from '../../types';

interface ProductCardProps {
  product: Product;
  /** Feeds the staggered grid entrance. */
  index?: number;
  onQuickView?: (product: Product) => void;
  /** Editorial grids give some cards a taller frame. */
  aspect?: 'tall' | 'standard';
}

export default function ProductCard({
  product,
  index = 0,
  onQuickView,
  aspect = 'standard',
}: ProductCardProps) {
  const [hovered, setHovered] = useState(false);
  const [size, setSize] = useState(product.sizes?.[0]?.size ?? 'M');

  const addItem = useCartStore((s) => s.addItem);
  const openCart = useUIStore((s) => s.openCart);
  const showToast = useUIStore((s) => s.showToast);
  const { items: wishlistItems, addItem: addToWishlist, removeItem: removeFromWishlist } =
    useWishlistStore();

  const wished = wishlistItems.find((w) => w.productId === product.id);
  const primary = product.images?.[0]?.url ?? media.productFallback;
  // Second shot is revealed on hover; fall back to the primary if there's only one.
  const secondary = product.images?.[1]?.url ?? primary;

  const stockFor = (s: string) =>
    product.inventory?.find((i) => i.size === s)?.quantity ?? Number.POSITIVE_INFINITY;

  const handleAddToCart = () => {
    if (stockFor(size) < 1) {
      showToast(`Size ${size} is sold out`, 'error');
      return;
    }
    addItem(product.id, size, 1, product);
    showToast(`${product.name} · size ${size} added`, 'success');
    openCart();
  };

  const handleWishlist = () => {
    if (wished) {
      removeFromWishlist(wished.id);
      showToast('Removed from wishlist', 'info');
    } else {
      addToWishlist(product.id, product);
      showToast('Saved to wishlist', 'success');
    }
  };

  return (
    <article
      className="group relative animate-fade-up"
      style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link
        to={`/product/${product.slug}`}
        className={`relative block overflow-hidden bg-charcoal ${
          aspect === 'tall' ? 'aspect-[3/5]' : 'aspect-[3/4]'
        }`}
      >
        <img
          src={primary}
          alt={product.name}
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 h-full w-full object-cover transition-all duration-[900ms] ease-editorial ${
            hovered ? 'scale-[1.06] opacity-0' : 'scale-100 opacity-100'
          }`}
        />
        <img
          src={secondary}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          className={`absolute inset-0 h-full w-full object-cover transition-all duration-[900ms] ease-editorial ${
            hovered ? 'scale-[1.06] opacity-100' : 'scale-100 opacity-0'
          }`}
        />

        {product.isLimited && (
          <span className="absolute left-3 top-3 bg-obsidian/80 px-3 py-1 text-meta uppercase text-pearl backdrop-blur-sm">
            Limited{product.editionNo ? ` · ${product.editionNo}/50` : ''}
          </span>
        )}
      </Link>

      {/* Hover controls — outside the Link so they aren't nested interactives */}
      <div
        className={`pointer-events-none absolute inset-x-0 bottom-0 flex justify-center gap-3 pb-[7.5rem] transition-all duration-500 ease-editorial ${
          hovered ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'
        }`}
      >
        <button
          onClick={handleAddToCart}
          className="pointer-events-auto flex h-10 w-10 items-center justify-center bg-pearl text-obsidian transition-colors hover:bg-denim hover:text-pearl"
          aria-label={`Add ${product.name} to cart`}
        >
          <ShoppingBag size={16} />
        </button>

        <button
          onClick={handleWishlist}
          className={`pointer-events-auto flex h-10 w-10 items-center justify-center transition-colors ${
            wished ? 'bg-denim text-pearl' : 'bg-pearl text-obsidian hover:bg-denim hover:text-pearl'
          }`}
          aria-label={wished ? `Remove ${product.name} from wishlist` : `Save ${product.name}`}
          aria-pressed={Boolean(wished)}
        >
          <Heart size={16} fill={wished ? 'currentColor' : 'none'} />
        </button>

        {onQuickView && (
          <button
            onClick={() => onQuickView(product)}
            className="pointer-events-auto flex h-10 w-10 items-center justify-center bg-pearl text-obsidian transition-colors hover:bg-denim hover:text-pearl"
            aria-label={`Quick view ${product.name}`}
          >
            <Eye size={16} />
          </button>
        )}
      </div>

      <div className="mt-4 space-y-2">
        <div className="flex items-start justify-between gap-4">
          <h3 className="font-display text-lg leading-snug transition-colors group-hover:text-denim">
            <Link to={`/product/${product.slug}`}>{product.name}</Link>
          </h3>
          <span className="whitespace-nowrap text-sm text-mist">
            {formatPrice(product.price, product.currency)}
          </span>
        </div>

        {product.category && (
          <p className="text-meta uppercase text-fog">{product.category.name}</p>
        )}

        {product.sizes && product.sizes.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {product.sizes.map((s) => {
              const soldOut = stockFor(s.size) < 1;
              return (
                <button
                  key={s.id}
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
      </div>
    </article>
  );
}

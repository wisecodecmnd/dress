import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Heart, ShoppingBag, X } from 'lucide-react';
import { useWishlistStore } from '../store/wishlistStore';
import { useCartStore } from '../store/cartStore';
import { useUIStore } from '../store/uiStore';
import { formatPrice } from '../utils/format';
import { media } from '../assets/media';

export default function Wishlist() {
  const { items, removeItem } = useWishlistStore();
  const addItem = useCartStore((s) => s.addItem);
  const openCart = useUIStore((s) => s.openCart);
  const showToast = useUIStore((s) => s.showToast);

  const moveToCart = (itemId: string, productId: string, size: string, product: (typeof items)[number]['product']) => {
    addItem(productId, size, 1, product);
    removeItem(itemId);
    showToast('Moved to cart', 'success');
    openCart();
  };

  return (
    <>
      <Helmet>
        <title>Wishlist — DENIMQUE</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="min-h-screen px-6 pb-24 pt-32 lg:px-12 lg:pt-40">
        <div className="mx-auto max-w-[110rem]">
          <span className="mb-4 block text-meta uppercase text-denim">Saved</span>
          <h1 className="mb-12 font-display text-display-lg">Your Wishlist</h1>

          {items.length === 0 ? (
            <div className="py-24 text-center">
              <Heart size={60} strokeWidth={1} className="mx-auto mb-6 text-stone" />
              <p className="mb-4 font-display text-2xl text-mist">Nothing saved yet</p>
              <Link
                to="/shop"
                className="text-meta uppercase text-denim transition-colors hover:text-pearl"
              >
                Browse the collection
              </Link>
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {items.map((item) => {
                const size = item.product.sizes?.[0]?.size ?? 'M';
                return (
                  <li key={item.id} className="group relative">
                    <Link
                      to={`/product/${item.product.slug}`}
                      className="block aspect-[3/4] overflow-hidden bg-charcoal"
                    >
                      <img
                        src={item.product.images?.[0]?.url ?? media.productFallback}
                        alt={item.product.name}
                        className="h-full w-full object-cover transition-transform duration-700 ease-editorial group-hover:scale-105"
                        loading="lazy"
                      />
                    </Link>

                    <button
                      onClick={() => removeItem(item.id)}
                      className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center bg-obsidian/70 text-mist backdrop-blur-sm transition-colors hover:text-red-400"
                      aria-label={`Remove ${item.product.name} from wishlist`}
                    >
                      <X size={15} />
                    </button>

                    <div className="mt-4">
                      <div className="flex items-start justify-between gap-3">
                        <h2 className="font-display text-lg">
                          <Link to={`/product/${item.product.slug}`}>{item.product.name}</Link>
                        </h2>
                        <span className="whitespace-nowrap text-sm text-mist">
                          {formatPrice(item.product.price, item.product.currency)}
                        </span>
                      </div>

                      <button
                        onClick={() => moveToCart(item.id, item.productId, size, item.product)}
                        className="mt-4 flex w-full items-center justify-center gap-2 border border-stone/50 py-3 text-meta uppercase text-mist transition-colors hover:border-pearl hover:text-pearl"
                      >
                        <ShoppingBag size={14} /> Move to cart · {size}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

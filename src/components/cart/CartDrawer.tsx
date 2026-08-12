import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, ShoppingBag, X } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useCartStore } from '../../store/cartStore';
import { useScrollLock } from '../../hooks/useSmoothScroll';
import { formatPrice } from '../../utils/format';

export default function CartDrawer() {
  const isOpen = useUIStore((s) => s.isCartOpen);
  const closeCart = useUIStore((s) => s.closeCart);
  const { items, subtotal, updateItem, removeItem } = useCartStore();

  useScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeCart();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeCart]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Shopping cart">
      <button
        className="absolute inset-0 bg-obsidian/70 backdrop-blur-sm"
        onClick={closeCart}
        aria-label="Close cart"
      />

      <aside className="absolute right-0 top-0 flex h-full w-full max-w-md animate-drawer-in flex-col border-l border-stone/40 bg-charcoal">
        <header className="flex items-center justify-between border-b border-stone/30 px-6 py-5">
          <h2 className="font-display text-xl">
            Your Cart <span className="text-fog">({items.length})</span>
          </h2>
          <button onClick={closeCart} aria-label="Close cart" className="text-fog hover:text-pearl">
            <X size={18} />
          </button>
        </header>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
            <ShoppingBag size={48} strokeWidth={1} className="text-stone" />
            <p className="font-display text-xl text-mist">Nothing here yet</p>
            <Link
              to="/shop"
              onClick={closeCart}
              className="text-meta uppercase text-denim hover:text-pearl"
            >
              Explore the collection
            </Link>
          </div>
        ) : (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-6 no-scrollbar">
              {items.map((item) => (
                <div key={item.id} className="flex gap-4">
                  <Link
                    to={`/product/${item.product.slug}`}
                    onClick={closeCart}
                    className="h-28 w-20 shrink-0 overflow-hidden bg-stone/20"
                  >
                    <img
                      src={item.product.images?.[0]?.url}
                      alt={item.product.name}
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  </Link>

                  <div className="flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-display text-base leading-tight">{item.product.name}</h3>
                      <button
                        onClick={() => removeItem(item.id)}
                        className="text-fog transition-colors hover:text-red-400"
                        aria-label={`Remove ${item.product.name}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                    <p className="mt-1 text-xs text-fog">Size {item.size}</p>

                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => updateItem(item.id, item.quantity - 1)}
                          className="flex h-7 w-7 items-center justify-center border border-stone/50 hover:border-pearl"
                          aria-label="Decrease quantity"
                        >
                          <Minus size={11} />
                        </button>
                        <span className="w-5 text-center text-sm tabular-nums">{item.quantity}</span>
                        <button
                          onClick={() => updateItem(item.id, item.quantity + 1)}
                          className="flex h-7 w-7 items-center justify-center border border-stone/50 hover:border-pearl"
                          aria-label="Increase quantity"
                        >
                          <Plus size={11} />
                        </button>
                      </div>
                      <span className="font-display text-sm">
                        {formatPrice(Number(item.product.price) * item.quantity)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <footer className="border-t border-stone/30 px-6 py-6">
              <div className="mb-1 flex justify-between font-display text-lg">
                <span>Subtotal</span>
                <span>{formatPrice(subtotal)}</span>
              </div>
              <p className="mb-5 text-xs text-fog">Shipping and tax calculated at checkout.</p>

              <Link
                to="/checkout"
                onClick={closeCart}
                className="block w-full bg-pearl py-4 text-center text-sm uppercase tracking-[0.18em] text-obsidian transition-colors hover:bg-white"
              >
                Checkout
              </Link>
              <button
                onClick={closeCart}
                className="mt-3 w-full py-3 text-center text-meta uppercase text-fog transition-colors hover:text-pearl"
              >
                Continue Shopping
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

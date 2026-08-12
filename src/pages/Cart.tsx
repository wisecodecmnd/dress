import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowRight, Minus, Plus, ShoppingBag, X } from 'lucide-react';
import { useCartStore } from '../store/cartStore';
import { formatPrice, orderTotals } from '../utils/format';
import { media } from '../assets/media';

export default function Cart() {
  const { items, subtotal, updateItem, removeItem } = useCartStore();
  const { shipping, tax, total } = orderTotals(subtotal);

  return (
    <>
      <Helmet>
        <title>Cart — DENIMQUE</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="min-h-screen px-6 pb-24 pt-32 lg:px-12 lg:pt-40">
        <div className="mx-auto max-w-[110rem]">
          <h1 className="mb-12 font-display text-display-lg">Your Cart</h1>

          {items.length === 0 ? (
            <div className="py-24 text-center">
              <ShoppingBag size={60} strokeWidth={1} className="mx-auto mb-6 text-stone" />
              <p className="mb-4 font-display text-2xl text-mist">Your cart is empty</p>
              <Link
                to="/shop"
                className="inline-flex items-center gap-2 text-meta uppercase text-denim transition-colors hover:text-pearl"
              >
                Continue Shopping <ArrowRight size={15} />
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-12 lg:grid-cols-3">
              <div className="space-y-6 lg:col-span-2">
                {items.map((item) => (
                  <div key={item.id} className="flex gap-6 border border-stone/30 p-4">
                    <Link
                      to={`/product/${item.product.slug}`}
                      className="h-32 w-24 shrink-0 overflow-hidden bg-stone/20"
                    >
                      <img
                        src={item.product.images?.[0]?.url ?? media.productFallback}
                        alt={item.product.name}
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                    </Link>

                    <div className="flex-1">
                      <div className="mb-2 flex items-start justify-between gap-4">
                        <h2 className="font-display text-lg">
                          <Link to={`/product/${item.product.slug}`}>{item.product.name}</Link>
                        </h2>
                        <button
                          onClick={() => removeItem(item.id)}
                          className="text-fog transition-colors hover:text-red-400"
                          aria-label={`Remove ${item.product.name}`}
                        >
                          <X size={16} />
                        </button>
                      </div>

                      <p className="mb-4 text-sm text-fog">Size: {item.size}</p>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <button
                            onClick={() => updateItem(item.id, item.quantity - 1)}
                            className="flex h-8 w-8 items-center justify-center border border-stone/50 transition-colors hover:border-pearl"
                            aria-label="Decrease quantity"
                          >
                            <Minus size={12} />
                          </button>
                          <span className="w-6 text-center tabular-nums">{item.quantity}</span>
                          <button
                            onClick={() => updateItem(item.id, item.quantity + 1)}
                            className="flex h-8 w-8 items-center justify-center border border-stone/50 transition-colors hover:border-pearl"
                            aria-label="Increase quantity"
                          >
                            <Plus size={12} />
                          </button>
                        </div>

                        <span className="font-display">
                          {formatPrice(Number(item.product.price) * item.quantity)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <aside className="lg:col-span-1">
                <div className="sticky top-28 border border-stone/30 p-6">
                  <h2 className="mb-6 font-display text-xl">Order Summary</h2>

                  <dl className="mb-6 space-y-3 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-fog">Subtotal</dt>
                      <dd>{formatPrice(subtotal)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-fog">Shipping</dt>
                      <dd>{shipping === 0 ? 'Free' : formatPrice(shipping)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-fog">Tax (18% GST)</dt>
                      <dd>{formatPrice(tax)}</dd>
                    </div>
                    <div className="flex justify-between border-t border-stone/30 pt-3 font-display text-lg">
                      <dt>Total</dt>
                      <dd>{formatPrice(total)}</dd>
                    </div>
                  </dl>

                  <Link
                    to="/checkout"
                    className="block w-full bg-pearl py-4 text-center text-sm uppercase tracking-[0.18em] text-obsidian transition-colors hover:bg-white"
                  >
                    Proceed to Checkout
                  </Link>
                  <Link
                    to="/shop"
                    className="mt-3 block w-full py-3 text-center text-meta uppercase text-fog transition-colors hover:text-pearl"
                  >
                    Continue Shopping
                  </Link>
                </div>
              </aside>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

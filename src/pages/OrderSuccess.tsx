import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Check, Clock } from 'lucide-react';
import { api } from '../services/api';
import { formatDate, formatPrice } from '../utils/format';
import { media } from '../assets/media';
import type { Order } from '../types';

export default function OrderSuccess() {
  const { id } = useParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    api
      .getOrder(id)
      .then((res) => {
        if (cancelled) return;
        setOrder(res.order);
        setState('ready');
      })
      .catch(() => !cancelled && setState('error'));

    return () => {
      cancelled = true;
    };
  }, [id]);

  const paid = order?.status !== 'PENDING';

  return (
    <>
      <Helmet>
        <title>Order Confirmed — DENIMQUE</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="min-h-screen px-6 pb-24 pt-32 lg:px-12 lg:pt-40">
        <div className="mx-auto max-w-3xl">
          {state === 'loading' && (
            <p className="text-center text-meta uppercase text-fog">Retrieving your order…</p>
          )}

          {state === 'error' && (
            <div className="text-center">
              <h1 className="mb-4 font-display text-display-md">We couldn't find that order</h1>
              <p className="mb-8 text-mist">
                If you were charged, your confirmation email has the details. Our atelier can help.
              </p>
              <Link
                to="/contact"
                className="border border-pearl/40 px-8 py-4 text-meta uppercase text-pearl transition-colors hover:bg-pearl hover:text-obsidian"
              >
                Contact us
              </Link>
            </div>
          )}

          {state === 'ready' && order && (
            <>
              <div className="mb-12 text-center">
                <div
                  className={`mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full border ${
                    paid ? 'border-denim text-denim' : 'border-stone text-fog'
                  }`}
                >
                  {paid ? <Check size={26} /> : <Clock size={24} />}
                </div>

                <h1 className="mb-4 font-display text-display-md">
                  {paid ? 'Thank you.' : 'Order received.'}
                </h1>

                <p className="text-body-lg text-mist">
                  {paid
                    ? `Order #${order.number} is confirmed. A receipt is on its way to ${order.email}.`
                    : `Order #${order.number} is reserved and awaiting payment confirmation. We'll email ${order.email} the moment it clears.`}
                </p>
              </div>

              <div className="border border-stone/30">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-stone/30 px-6 py-4 text-sm">
                  <div>
                    <span className="mb-1 block text-meta uppercase text-fog">Order</span>
                    <span>#{order.number}</span>
                  </div>
                  <div>
                    <span className="mb-1 block text-meta uppercase text-fog">Placed</span>
                    <span>{formatDate(order.createdAt)}</span>
                  </div>
                  <div>
                    <span className="mb-1 block text-meta uppercase text-fog">Status</span>
                    <span className="capitalize">{order.status.toLowerCase()}</span>
                  </div>
                </div>

                <ul className="divide-y divide-stone/20">
                  {order.items.map((item) => (
                    <li key={item.id} className="flex items-center gap-4 px-6 py-4">
                      <div className="h-20 w-16 shrink-0 overflow-hidden bg-stone/20">
                        <img
                          src={item.image ?? media.productFallback}
                          alt=""
                          className="h-full w-full object-cover"
                          loading="lazy"
                        />
                      </div>
                      <div className="flex-1">
                        <p className="font-display">{item.name}</p>
                        <p className="text-xs text-fog">
                          Size {item.size} · Qty {item.quantity}
                        </p>
                      </div>
                      <span className="text-sm">
                        {formatPrice(Number(item.unitPrice) * item.quantity, order.currency)}
                      </span>
                    </li>
                  ))}
                </ul>

                <dl className="space-y-2 border-t border-stone/30 px-6 py-5 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-fog">Subtotal</dt>
                    <dd>{formatPrice(order.subtotal, order.currency)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-fog">Shipping</dt>
                    <dd>
                      {Number(order.shipping) === 0
                        ? 'Free'
                        : formatPrice(order.shipping, order.currency)}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-fog">Tax</dt>
                    <dd>{formatPrice(order.tax, order.currency)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-stone/30 pt-3 font-display text-lg">
                    <dt>Total</dt>
                    <dd>{formatPrice(order.total, order.currency)}</dd>
                  </div>
                </dl>

                {order.address && (
                  <div className="border-t border-stone/30 px-6 py-5 text-sm text-mist">
                    <span className="mb-2 block text-meta uppercase text-fog">Shipping to</span>
                    <p>{order.address.line1}</p>
                    {order.address.line2 && <p>{order.address.line2}</p>}
                    <p>
                      {order.address.city}, {order.address.state} {order.address.pincode}
                    </p>
                    <p>{order.address.country}</p>
                  </div>
                )}
              </div>

              <div className="mt-10 flex flex-wrap justify-center gap-4">
                <Link
                  to="/shop"
                  className="bg-pearl px-8 py-4 text-meta uppercase text-obsidian transition-colors hover:bg-white"
                >
                  Continue Shopping
                </Link>
                <Link
                  to="/account?tab=orders"
                  className="border border-stone/50 px-8 py-4 text-meta uppercase text-mist transition-colors hover:border-pearl hover:text-pearl"
                >
                  View all orders
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

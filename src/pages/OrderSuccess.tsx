import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { AlertTriangle, Check, Clock } from 'lucide-react';
import { api } from '../services/api';
import { formatDate, formatPrice } from '../utils/format';
import { media } from '../assets/media';
import type { Order, PaymentStatus } from '../types';

/**
 * The customer's view of "did my payment work?".
 *
 * It reads the *payment* status, never the order status — an order can legally
 * be CONFIRMED while its payment is still pending, and showing "Thank you" for
 * that would be a lie. Success is only claimed for a payment the server has
 * verified as CAPTURED.
 *
 * When a gateway redirects the browser back here, the page asks the API to
 * verify the return leg. That call performs a server-side status read against
 * the provider; the URL the customer arrives on is not evidence of anything.
 */
const SETTLED: PaymentStatus[] = ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'];

export default function OrderSuccess() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [order, setOrder] = useState<Order | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [verifying, setVerifying] = useState(false);

  const cancelled = params.get('cancelled') === '1';

  useEffect(() => {
    if (!id) return;
    let dropped = false;

    async function load() {
      try {
        const { order: loaded } = await api.getOrder(id!);
        if (dropped) return;
        setOrder(loaded);
        setState('ready');

        // Not settled yet: ask the server to check with the provider. A
        // cancelled return leg is still worth checking — the customer may have
        // paid and then hit back.
        const status = loaded.payment?.status;
        if (status && !SETTLED.includes(status) && loaded.payment?.provider !== 'manual') {
          setVerifying(true);
          const result = await api.confirmPayment({ orderId: id! }).catch(() => null);
          if (dropped) return;
          setVerifying(false);
          if (result) setOrder(result.order);
        }
      } catch {
        if (!dropped) setState('error');
      }
    }

    void load();

    return () => {
      dropped = true;
    };
  }, [id]);

  const paymentStatus = order?.payment?.status;
  const paid = paymentStatus ? SETTLED.includes(paymentStatus) : false;
  const failed = paymentStatus === 'FAILED';

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
                    paid
                      ? 'border-denim text-denim'
                      : failed
                        ? 'border-red-500/70 text-red-400'
                        : 'border-stone text-fog'
                  }`}
                >
                  {paid ? <Check size={26} /> : failed ? <AlertTriangle size={24} /> : <Clock size={24} />}
                </div>

                <h1 className="mb-4 font-display text-display-md">
                  {paid ? 'Thank you.' : failed ? "That payment didn't go through." : 'Order received.'}
                </h1>

                <p className="text-body-lg text-mist">
                  {paid
                    ? `Order #${order.number} is paid. A receipt is on its way to ${order.email}.`
                    : failed
                      ? `Order #${order.number} is reserved but unpaid — nothing was charged. You can settle it from your account, or the atelier can send a new payment link.`
                      : verifying
                        ? `Checking with the payment provider…`
                        : cancelled
                          ? `Order #${order.number} is reserved but the payment was cancelled. Nothing was charged.`
                          : `Order #${order.number} is reserved and awaiting payment confirmation. We'll email ${order.email} the moment it clears.`}
                </p>

                {order.payment?.status === 'AUTHORIZED' && (
                  <p className="mt-3 text-sm text-fog">
                    Your bank has authorised the payment; we're waiting for the provider to confirm
                    the capture.
                  </p>
                )}
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
                  <div>
                    <span className="mb-1 block text-meta uppercase text-fog">Payment</span>
                    <span className="capitalize">
                      {(order.payment?.status ?? 'PENDING').toLowerCase().replace(/_/g, ' ')}
                    </span>
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

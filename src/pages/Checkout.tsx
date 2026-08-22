import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Lock } from 'lucide-react';
import { api } from '../services/api';
import { handOffToProvider } from '../services/paymentHandoff';
import { useCartStore } from '../store/cartStore';
import { useUIStore } from '../store/uiStore';
import { formatPrice, orderTotals } from '../utils/format';
import { media } from '../assets/media';
import type { PaymentMethod, PaymentProviderId } from '../types';

interface CheckoutForm {
  email: string;
  phone: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  country: string;
  pincode: string;
}

const EMPTY: CheckoutForm = {
  email: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  country: 'India',
  pincode: '',
};

type Errors = Partial<Record<keyof CheckoutForm, string>>;

function validate(f: CheckoutForm): Errors {
  const e: Errors = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(f.email)) e.email = 'A valid email is required';
  if (!/^[+\d][\d\s-]{6,}$/.test(f.phone)) e.phone = 'A valid phone number is required';
  if (f.line1.trim().length < 4) e.line1 = 'Street address is required';
  if (f.city.trim().length < 2) e.city = 'City is required';
  if (f.state.trim().length < 2) e.state = 'State is required';
  if (f.country.trim().length < 2) e.country = 'Country is required';
  if (!/^\d{4,10}$/.test(f.pincode.trim())) e.pincode = 'Enter a valid postal code';
  return e;
}

export default function Checkout() {
  const navigate = useNavigate();
  const { items, subtotal, clearCart } = useCartStore();
  const showToast = useUIStore((s) => s.showToast);

  const [form, setForm] = useState<CheckoutForm>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);

  // Payment methods come from the API, which only lists providers it is
  // actually configured for. The storefront never decides what is available.
  const [methods, setMethods] = useState<PaymentMethod[] | null>(null);
  const [mode, setMode] = useState<'test' | 'live'>('live');
  const [chosen, setChosen] = useState<PaymentProviderId | null>(null);

  useEffect(() => {
    let cancelled = false;

    api
      .getPaymentMethods()
      .then((res) => {
        if (cancelled) return;
        setMethods(res.methods);
        setMode(res.mode);
        setChosen(res.methods[0]?.id ?? null);
      })
      // An empty list is the honest answer to "we couldn't ask": the submit
      // button then explains payment is unavailable rather than taking an order
      // we cannot charge for.
      .catch(() => !cancelled && setMethods([]));

    return () => {
      cancelled = true;
    };
  }, []);

  const { shipping, tax, total } = orderTotals(subtotal);

  const input = (key: keyof CheckoutForm, placeholder: string, type = 'text') => (
    <div>
      <input
        type={type}
        placeholder={placeholder}
        aria-label={placeholder}
        aria-invalid={Boolean(errors[key])}
        value={form[key]}
        onChange={(e) => {
          setForm((f) => ({ ...f, [key]: e.target.value }));
          if (errors[key]) setErrors((prev) => ({ ...prev, [key]: undefined }));
        }}
        className={`w-full border bg-transparent px-4 py-3 text-pearl outline-none transition-colors placeholder:text-stone ${
          errors[key] ? 'border-red-500/70' : 'border-stone/50 focus:border-pearl'
        }`}
      />
      {errors[key] && <p className="mt-1 text-xs text-red-400">{errors[key]}</p>}
    </div>
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      showToast('Check the highlighted fields', 'error');
      return;
    }

    if (!chosen) {
      showToast('Payment is unavailable right now — please try again shortly', 'error');
      return;
    }

    setSubmitting(true);
    try {
      // 1. Create the order server-side. Prices are recalculated from the DB
      //    there — the client total below is display only.
      const { order } = await api.createOrder({
        email: form.email.trim(),
        phone: form.phone.trim(),
        address: {
          label: 'Shipping',
          line1: form.line1.trim(),
          line2: form.line2.trim() || null,
          city: form.city.trim(),
          state: form.state.trim(),
          country: form.country.trim(),
          pincode: form.pincode.trim(),
        },
        items: items.map((i) => ({ productId: i.productId, size: i.size, quantity: i.quantity })),
      });

      // 2. Ask the API to open a charge with the chosen provider. The amount is
      //    recomputed server-side from the order; nothing here is trusted.
      const intent = await api.createPaymentIntent(order.id, chosen);

      // The basket has become an order, so it is safe to clear regardless of
      // how the payment goes — the order page is now the source of truth.
      clearCart();

      // 3. Hand off to the gateway. A redirect leaves the page; an in-page SDK
      //    returns evidence for the server to verify.
      const handoff = await handOffToProvider(intent, {
        email: form.email.trim(),
        phone: form.phone.trim(),
      });

      if (handoff.kind === 'redirecting') return;

      if (handoff.kind === 'failed') {
        showToast(handoff.message, 'error');
        navigate(`/order-success/${order.id}`);
        return;
      }

      if (handoff.kind === 'cancelled') {
        showToast('Payment cancelled — your order is reserved but unpaid', 'info');
        navigate(`/order-success/${order.id}`);
        return;
      }

      if (handoff.kind === 'submitted') {
        // 4. Only the server may conclude that this succeeded.
        try {
          const result = await api.confirmPayment({
            orderId: order.id,
            payload: handoff.payload,
          });
          if (result.outcome === 'confirmed' || result.payment.status === 'CAPTURED') {
            showToast('Payment confirmed', 'success');
          } else if (result.outcome === 'amount-mismatch') {
            showToast('That payment did not match the order total — nothing was captured', 'error');
          } else {
            showToast('Payment received — awaiting confirmation', 'info');
          }
        } catch (verifyError) {
          // The gateway may still settle it by webhook, so this is not a
          // failure of the order — just of our immediate confirmation.
          showToast(
            verifyError instanceof Error
              ? verifyError.message
              : 'We could not confirm the payment yet',
            'error',
          );
        }
      }

      navigate(`/order-success/${order.id}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Checkout failed', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 pt-32">
        <div className="text-center">
          <p className="mb-4 font-display text-2xl text-mist">Your cart is empty</p>
          <button
            onClick={() => navigate('/shop')}
            className="text-meta uppercase text-denim transition-colors hover:text-pearl"
          >
            Continue Shopping
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>Checkout — DENIMQUE</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="min-h-screen px-6 pb-24 pt-32 lg:px-12 lg:pt-40">
        <div className="mx-auto max-w-[110rem]">
          <h1 className="mb-12 font-display text-display-lg">Checkout</h1>

          <div className="grid grid-cols-1 gap-16 lg:grid-cols-2">
            <form onSubmit={handleSubmit} className="space-y-8" noValidate>
              <fieldset>
                <legend className="mb-4 text-meta uppercase text-fog">Contact</legend>
                <div className="space-y-4">
                  {input('email', 'Email', 'email')}
                  {input('phone', 'Phone', 'tel')}
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-4 text-meta uppercase text-fog">Shipping Address</legend>
                <div className="space-y-4">
                  {input('line1', 'Address line 1')}
                  {input('line2', 'Address line 2 (optional)')}
                  <div className="grid grid-cols-2 gap-4">
                    {input('city', 'City')}
                    {input('state', 'State')}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {input('country', 'Country')}
                    {input('pincode', 'Pincode')}
                  </div>
                </div>
              </fieldset>

              <fieldset>
                <legend className="mb-4 text-meta uppercase text-fog">Payment</legend>

                {methods === null && (
                  <p className="border border-stone/50 p-4 text-sm text-fog">
                    Checking available payment methods…
                  </p>
                )}

                {methods?.length === 0 && (
                  <p className="border border-red-500/50 p-4 text-sm text-red-400">
                    Online payment is unavailable right now. Nothing has been charged — please try
                    again shortly or contact the atelier.
                  </p>
                )}

                {methods && methods.length > 0 && (
                  <div className="space-y-2">
                    {methods.map((method) => (
                      <label
                        key={method.id}
                        className={`flex cursor-pointer items-center gap-3 border p-4 transition-colors ${
                          chosen === method.id
                            ? 'border-pearl bg-pearl/5'
                            : 'border-stone/50 hover:border-stone'
                        }`}
                      >
                        <input
                          type="radio"
                          name="paymentProvider"
                          value={method.id}
                          checked={chosen === method.id}
                          onChange={() => setChosen(method.id)}
                          className="accent-pearl"
                        />
                        <span className="text-sm text-mist">{method.label}</span>
                      </label>
                    ))}
                  </div>
                )}

                <p className="mt-2 flex items-center gap-2 text-xs text-fog">
                  <Lock size={12} /> Payment is captured by the provider. Your order stays unpaid
                  until the provider's own confirmation reaches our server.
                </p>

                {mode === 'test' && methods && methods.length > 0 && (
                  <p className="mt-2 text-xs uppercase tracking-[0.18em] text-amber-400">
                    Test mode — no real money will move
                  </p>
                )}
              </fieldset>

              <button
                type="submit"
                disabled={submitting || !chosen}
                className="w-full bg-pearl py-4 text-sm uppercase tracking-[0.18em] text-obsidian transition-colors hover:bg-white disabled:opacity-50"
              >
                {submitting
                  ? 'Processing…'
                  : methods?.length === 0
                    ? 'Payment unavailable'
                    : `Place Order · ${formatPrice(total)}`}
              </button>
            </form>

            <aside className="lg:border-l lg:border-stone/30 lg:pl-12">
              <h2 className="mb-6 font-display text-xl">Order Summary</h2>

              <ul className="mb-6 space-y-4">
                {items.map((item) => (
                  <li key={item.id} className="flex gap-4">
                    <div className="relative h-20 w-16 shrink-0 overflow-hidden bg-stone/20">
                      <img
                        src={item.product.images?.[0]?.url ?? media.productFallback}
                        alt=""
                        className="h-full w-full object-cover"
                        loading="lazy"
                      />
                      <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center bg-stone text-[10px]">
                        {item.quantity}
                      </span>
                    </div>
                    <div className="flex-1">
                      <p className="font-display text-sm">{item.product.name}</p>
                      <p className="text-xs text-fog">Size: {item.size}</p>
                    </div>
                    <span className="text-sm">
                      {formatPrice(Number(item.product.price) * item.quantity)}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="space-y-3 border-t border-stone/30 pt-6 text-sm">
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
                <div className="flex justify-between border-t border-stone/30 pt-3 font-display text-xl">
                  <dt>Total</dt>
                  <dd>{formatPrice(total)}</dd>
                </div>
              </dl>
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}

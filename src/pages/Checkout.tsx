import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { CreditCard, Lock } from 'lucide-react';
import { api } from '../services/api';
import { useCartStore } from '../store/cartStore';
import { useUIStore } from '../store/uiStore';
import { formatPrice, orderTotals } from '../utils/format';
import { media } from '../assets/media';

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

      // 2. Ask the API to open a payment intent with whichever provider is
      //    configured. Nothing is marked paid here — the provider's webhook or
      //    the /payments/confirm callback does that.
      const intent = await api.createPaymentIntent(order.id);

      clearCart();

      if (intent.provider === 'manual') {
        navigate(`/order-success/${order.id}`);
      } else {
        // Razorpay/Stripe hand-off lives here; their SDK redirects and the
        // provider calls back into /api/payments/confirm.
        showToast(`Redirecting to ${intent.provider}…`, 'info');
        navigate(`/order-success/${order.id}`);
      }
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
                <div className="flex items-center gap-3 border border-stone/50 p-4">
                  <CreditCard size={19} className="text-fog" />
                  <span className="text-sm text-mist">
                    The API selects the configured provider (Razorpay, Stripe, or manual).
                  </span>
                </div>
                <p className="mt-2 flex items-center gap-2 text-xs text-fog">
                  <Lock size={12} /> Payment is captured by the provider. Orders stay unpaid until
                  their callback confirms the charge.
                </p>
              </fieldset>

              <button
                type="submit"
                disabled={submitting}
                className="w-full bg-pearl py-4 text-sm uppercase tracking-[0.18em] text-obsidian transition-colors hover:bg-white disabled:opacity-50"
              >
                {submitting ? 'Processing…' : `Place Order · ${formatPrice(total)}`}
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

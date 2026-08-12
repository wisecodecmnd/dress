import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Heart, LogOut, Package, User as UserIcon, X } from 'lucide-react';
import { api } from '../services/api';
import { useAuthStore } from '../store/authStore';
import { useWishlistStore } from '../store/wishlistStore';
import { useUIStore } from '../store/uiStore';
import { formatDate, formatPrice } from '../utils/format';
import { media } from '../assets/media';
import type { Address, Order } from '../types';

const TABS = [
  { id: 'profile', label: 'Profile', Icon: UserIcon },
  { id: 'orders', label: 'Orders', Icon: Package },
  { id: 'wishlist', label: 'Wishlist', Icon: Heart },
] as const;

type TabId = (typeof TABS)[number]['id'];

const statusTone: Record<string, string> = {
  PENDING: 'text-fog',
  PAID: 'text-denim',
  PROCESSING: 'text-denim',
  SHIPPED: 'text-denim',
  DELIVERED: 'text-pearl',
  CANCELLED: 'text-red-400',
  REFUNDED: 'text-red-400',
};

export default function Account() {
  const { user, isAuthenticated, isLoading, login, register, logout } = useAuthStore();
  const { items: wishlistItems, removeItem: removeWishlistItem, fetchWishlist } = useWishlistStore();
  const showToast = useUIStore((s) => s.showToast);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : 'profile';

  const [orders, setOrders] = useState<Order[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [busy, setBusy] = useState(false);
  const [credentials, setCredentials] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
  });

  useEffect(() => {
    if (!isAuthenticated) return;
    void fetchWishlist();
    api
      .getOrders()
      .then((res) => setOrders(res.orders))
      .catch(() => setOrders([]));
    api
      .getAddresses()
      .then((res) => setAddresses(res.addresses))
      .catch(() => setAddresses([]));
  }, [isAuthenticated, fetchWishlist]);

  const setTab = (next: TabId) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === 'login') {
        await login(credentials.email.trim(), credentials.password);
      } else {
        await register({
          email: credentials.email.trim(),
          password: credentials.password,
          firstName: credentials.firstName.trim() || undefined,
          lastName: credentials.lastName.trim() || undefined,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <span className="text-meta uppercase text-fog">Checking your session…</span>
      </div>
    );
  }

  // ── Signed out: sign-in / register ────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <>
        <Helmet>
          <title>Account — DENIMQUE</title>
          <meta name="robots" content="noindex" />
        </Helmet>

        <div className="flex min-h-screen items-center justify-center px-6 pt-28">
          <div className="w-full max-w-md">
            <h1 className="mb-8 text-center font-display text-display-md">
              {mode === 'login' ? 'Welcome Back' : 'Create Account'}
            </h1>

            <form onSubmit={handleSubmit} className="space-y-5">
              {mode === 'register' && (
                <div className="grid grid-cols-2 gap-4">
                  <input
                    type="text"
                    placeholder="First name"
                    aria-label="First name"
                    autoComplete="given-name"
                    value={credentials.firstName}
                    onChange={(e) =>
                      setCredentials((c) => ({ ...c, firstName: e.target.value }))
                    }
                    className="w-full border border-stone/50 bg-transparent px-4 py-3 text-pearl outline-none transition-colors placeholder:text-stone focus:border-pearl"
                  />
                  <input
                    type="text"
                    placeholder="Last name"
                    aria-label="Last name"
                    autoComplete="family-name"
                    value={credentials.lastName}
                    onChange={(e) => setCredentials((c) => ({ ...c, lastName: e.target.value }))}
                    className="w-full border border-stone/50 bg-transparent px-4 py-3 text-pearl outline-none transition-colors placeholder:text-stone focus:border-pearl"
                  />
                </div>
              )}

              <input
                type="email"
                required
                placeholder="Email"
                aria-label="Email"
                autoComplete="email"
                value={credentials.email}
                onChange={(e) => setCredentials((c) => ({ ...c, email: e.target.value }))}
                className="w-full border border-stone/50 bg-transparent px-4 py-3 text-pearl outline-none transition-colors placeholder:text-stone focus:border-pearl"
              />

              <input
                type="password"
                required
                minLength={8}
                placeholder="Password"
                aria-label="Password"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                value={credentials.password}
                onChange={(e) => setCredentials((c) => ({ ...c, password: e.target.value }))}
                className="w-full border border-stone/50 bg-transparent px-4 py-3 text-pearl outline-none transition-colors placeholder:text-stone focus:border-pearl"
              />

              {mode === 'register' && (
                <p className="text-xs text-fog">At least 8 characters.</p>
              )}

              <button
                type="submit"
                disabled={busy}
                className="w-full bg-pearl py-4 text-sm uppercase tracking-[0.18em] text-obsidian transition-colors hover:bg-white disabled:opacity-50"
              >
                {busy ? 'Please wait…' : mode === 'login' ? 'Sign In' : 'Create Account'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-fog">
              {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
              <button
                onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
                className="text-denim transition-colors hover:text-pearl"
              >
                {mode === 'login' ? 'Create one' : 'Sign in'}
              </button>
            </p>
          </div>
        </div>
      </>
    );
  }

  // ── Signed in ─────────────────────────────────────────────────────────────
  return (
    <>
      <Helmet>
        <title>My Account — DENIMQUE</title>
        <meta name="robots" content="noindex" />
      </Helmet>

      <div className="min-h-screen px-6 pb-24 pt-32 lg:px-12 lg:pt-40">
        <div className="mx-auto max-w-[110rem]">
          <div className="mb-12 flex flex-col items-start justify-between gap-4 lg:flex-row lg:items-center">
            <div>
              <h1 className="font-display text-display-md">My Account</h1>
              <p className="mt-1 text-fog">{user?.email}</p>
            </div>

            <button
              onClick={async () => {
                await logout();
                showToast('Signed out', 'info');
              }}
              className="flex items-center gap-2 border border-stone/50 px-6 py-3 text-meta uppercase text-fog transition-colors hover:border-pearl hover:text-pearl"
            >
              <LogOut size={15} /> Sign Out
            </button>
          </div>

          <div className="grid grid-cols-1 gap-12 lg:grid-cols-4">
            {/* Sidebar */}
            <nav className="lg:col-span-1" aria-label="Account sections">
              <ul className="flex gap-2 overflow-x-auto no-scrollbar lg:flex-col">
                {TABS.map(({ id, label, Icon }) => (
                  <li key={id} className="shrink-0 lg:w-full">
                    <button
                      onClick={() => setTab(id)}
                      aria-current={tab === id ? 'true' : undefined}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left text-sm transition-colors ${
                        tab === id ? 'bg-charcoal text-pearl' : 'text-fog hover:text-pearl'
                      }`}
                    >
                      <Icon size={16} /> {label}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>

            <div className="lg:col-span-3">
              {/* Profile */}
              {tab === 'profile' && (
                <section className="space-y-10">
                  <div>
                    <h2 className="mb-6 font-display text-2xl">Details</h2>
                    <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                      {[
                        { label: 'First name', value: user?.firstName ?? '—' },
                        { label: 'Last name', value: user?.lastName ?? '—' },
                        { label: 'Email', value: user?.email ?? '—' },
                        { label: 'Orders placed', value: String(orders.length) },
                      ].map((row) => (
                        <div key={row.label} className="border-b border-stone/30 pb-3">
                          <dt className="mb-1 text-meta uppercase text-fog">{row.label}</dt>
                          <dd className="text-mist">{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  <div>
                    <h2 className="mb-6 font-display text-2xl">Saved addresses</h2>
                    {addresses.length === 0 ? (
                      <p className="text-sm text-fog">
                        No saved addresses yet — the address you use at checkout is stored here.
                      </p>
                    ) : (
                      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {addresses.map((a) => (
                          <li key={a.id} className="border border-stone/30 p-4 text-sm text-mist">
                            {a.label && (
                              <span className="mb-2 block text-meta uppercase text-fog">
                                {a.label}
                              </span>
                            )}
                            <p>{a.line1}</p>
                            {a.line2 && <p>{a.line2}</p>}
                            <p>
                              {a.city}, {a.state} {a.pincode}
                            </p>
                            <p>{a.country}</p>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </section>
              )}

              {/* Orders */}
              {tab === 'orders' && (
                <section>
                  <h2 className="mb-6 font-display text-2xl">Order history</h2>

                  {orders.length === 0 ? (
                    <div className="border border-stone/30 p-10 text-center">
                      <Package size={44} strokeWidth={1} className="mx-auto mb-4 text-stone" />
                      <p className="mb-3 font-display text-xl text-mist">No orders yet</p>
                      <Link to="/shop" className="text-meta uppercase text-denim link-underline">
                        Start with the collection
                      </Link>
                    </div>
                  ) : (
                    <ul className="space-y-4">
                      {orders.map((order) => (
                        <li key={order.id} className="border border-stone/30 p-5">
                          <div className="mb-4 flex flex-wrap items-start justify-between gap-4">
                            <div>
                              <p className="font-display text-lg">#{order.number}</p>
                              <p className="text-xs text-fog">{formatDate(order.createdAt)}</p>
                            </div>
                            <div className="text-right">
                              <p className="font-display">
                                {formatPrice(order.total, order.currency)}
                              </p>
                              <p
                                className={`text-meta uppercase ${statusTone[order.status] ?? 'text-fog'}`}
                              >
                                {order.status.toLowerCase()}
                              </p>
                            </div>
                          </div>

                          <ul className="space-y-2">
                            {order.items.map((item) => (
                              <li
                                key={item.id}
                                className="flex items-center gap-3 text-sm text-mist"
                              >
                                <div className="h-14 w-11 shrink-0 overflow-hidden bg-stone/20">
                                  <img
                                    src={item.image ?? media.productFallback}
                                    alt=""
                                    className="h-full w-full object-cover"
                                    loading="lazy"
                                  />
                                </div>
                                <span className="flex-1">
                                  {item.name}
                                  <span className="text-fog">
                                    {' '}
                                    · {item.size} · ×{item.quantity}
                                  </span>
                                </span>
                                <span>{formatPrice(item.unitPrice, order.currency)}</span>
                              </li>
                            ))}
                          </ul>

                          <Link
                            to={`/order-success/${order.id}`}
                            className="mt-4 inline-block text-meta uppercase text-denim link-underline"
                          >
                            View order
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}

              {/* Wishlist */}
              {tab === 'wishlist' && (
                <section>
                  <h2 className="mb-6 font-display text-2xl">Wishlist</h2>

                  {wishlistItems.length === 0 ? (
                    <div className="border border-stone/30 p-10 text-center">
                      <Heart size={44} strokeWidth={1} className="mx-auto mb-4 text-stone" />
                      <p className="mb-3 font-display text-xl text-mist">Nothing saved yet</p>
                      <Link to="/shop" className="text-meta uppercase text-denim link-underline">
                        Find something worth keeping
                      </Link>
                    </div>
                  ) : (
                    <ul className="grid grid-cols-2 gap-6 lg:grid-cols-3">
                      {wishlistItems.map((item) => (
                        <li key={item.id} className="group relative">
                          <Link
                            to={`/product/${item.product.slug}`}
                            className="block aspect-[3/4] overflow-hidden bg-charcoal"
                          >
                            <img
                              src={item.product.images?.[0]?.url ?? media.productFallback}
                              alt={item.product.name}
                              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                              loading="lazy"
                            />
                          </Link>

                          <button
                            onClick={() => removeWishlistItem(item.id)}
                            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center bg-obsidian/70 text-mist transition-colors hover:text-red-400"
                            aria-label={`Remove ${item.product.name} from wishlist`}
                          >
                            <X size={14} />
                          </button>

                          <div className="mt-3">
                            <p className="font-display">{item.product.name}</p>
                            <p className="text-sm text-fog">
                              {formatPrice(item.product.price, item.product.currency)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

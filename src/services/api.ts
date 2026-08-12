import type {
  Address,
  CartItem,
  Category,
  CustomizationGroup,
  CustomizationSelection,
  Order,
  Product,
  User,
  WishlistItem,
} from '../types';

/**
 * In dev, Vite proxies /api to the Express server (see vite.config.ts).
 * In prod, set VITE_API_URL to the deployed API origin.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class ApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api${path}`, {
    // Cookie-based auth: the access token is an httpOnly cookie set by the API.
    credentials: 'include',
    headers:
      init.body instanceof FormData
        ? init.headers
        : { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : null) ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status, payload);
  }

  return payload as T;
}

export const api = {
  // ── Catalogue ────────────────────────────────────────────────────────────
  getProducts: (query = '') =>
    request<{ products: Product[]; total: number }>(`/products${query ? `?${query}` : ''}`),
  getProduct: (slug: string) => request<{ product: Product }>(`/products/${slug}`),
  getFeatured: () => request<{ products: Product[] }>('/products?featured=true&limit=3'),
  getCategories: () => request<{ categories: Category[] }>('/categories'),
  search: (q: string) => request<{ products: Product[] }>(`/search?q=${encodeURIComponent(q)}`),

  // ── Cart (authenticated users; guests are served from localStorage) ──────
  getCart: () => request<{ items: CartItem[] }>('/cart'),
  addToCart: (body: { productId: string; size: string; quantity: number }) =>
    request<{ item: CartItem }>('/cart', { method: 'POST', body: JSON.stringify(body) }),
  updateCartItem: (itemId: string, quantity: number) =>
    request<{ item: CartItem }>(`/cart/${itemId}`, {
      method: 'PATCH',
      body: JSON.stringify({ quantity }),
    }),
  removeCartItem: (itemId: string) =>
    request<{ ok: true }>(`/cart/${itemId}`, { method: 'DELETE' }),

  // ── Wishlist ─────────────────────────────────────────────────────────────
  getWishlist: () => request<{ items: WishlistItem[] }>('/wishlist'),
  addToWishlist: (productId: string) =>
    request<{ item: WishlistItem }>('/wishlist', {
      method: 'POST',
      body: JSON.stringify({ productId }),
    }),
  removeWishlistItem: (itemId: string) =>
    request<{ ok: true }>(`/wishlist/${itemId}`, { method: 'DELETE' }),

  // ── Orders ───────────────────────────────────────────────────────────────
  createOrder: (body: {
    addressId?: string;
    address?: Omit<Address, 'id'>;
    email: string;
    phone: string;
    items?: { productId: string; size: string; quantity: number }[];
  }) => request<{ order: Order }>('/orders', { method: 'POST', body: JSON.stringify(body) }),
  getOrders: () => request<{ orders: Order[] }>('/orders'),
  getOrder: (id: string) => request<{ order: Order }>(`/orders/${id}`),

  // ── Payments (provider-agnostic; see server/src/services/payment) ────────
  createPaymentIntent: (orderId: string) =>
    request<{ provider: string; clientSecret?: string; orderId: string; amount: number }>(
      '/payments/intent',
      { method: 'POST', body: JSON.stringify({ orderId }) },
    ),
  confirmPayment: (body: { orderId: string; reference: string }) =>
    request<{ order: Order }>('/payments/confirm', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // ── Auth ─────────────────────────────────────────────────────────────────
  login: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  register: (body: { email: string; password: string; firstName?: string; lastName?: string }) =>
    request<{ user: User }>('/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  me: () => request<{ user: User }>('/auth/me'),

  // ── Account ──────────────────────────────────────────────────────────────
  getAddresses: () => request<{ addresses: Address[] }>('/users/addresses'),
  createAddress: (body: Omit<Address, 'id'>) =>
    request<{ address: Address }>('/users/addresses', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateProfile: (body: { firstName?: string; lastName?: string }) =>
    request<{ user: User }>('/users/me', { method: 'PATCH', body: JSON.stringify(body) }),

  // ── Contact ──────────────────────────────────────────────────────────────
  sendContact: (body: {
    name: string;
    email: string;
    phone?: string;
    subject: string;
    message: string;
  }) => request<{ ok: true }>('/contact', { method: 'POST', body: JSON.stringify(body) }),

  // ── Customization ────────────────────────────────────────────────────────
  getCustomizationOptions: () => request<{ groups: CustomizationGroup[] }>('/customization/options'),
  saveCustomization: (body: { productId: string; selection: CustomizationSelection }) =>
    request<{ id: string }>('/customization', { method: 'POST', body: JSON.stringify(body) }),
};

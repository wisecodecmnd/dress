export interface ProductImage {
  id: string;
  url: string;
  alt?: string | null;
  position: number;
}

export interface ProductSize {
  id: string;
  size: string;
  position: number;
}

export interface InventoryLevel {
  size: string;
  quantity: number;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
}

export interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  story?: string | null;
  fabric?: string | null;
  fit?: string | null;
  care?: string | null;
  shipping?: string | null;
  /** Decimal serialised as string by the API — always coerce before maths. */
  price: string | number;
  comparePrice?: string | number | null;
  currency: string;
  color?: string | null;
  isLimited: boolean;
  editionNo?: number | null;
  category?: Category | null;
  images?: ProductImage[];
  sizes?: ProductSize[];
  inventory?: InventoryLevel[];
  createdAt?: string;
}

export interface CartItem {
  id: string;
  productId: string;
  product: Product;
  size: string;
  quantity: number;
}

export interface WishlistItem {
  id: string;
  productId: string;
  product: Product;
}

export interface Address {
  id: string;
  label?: string | null;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  country: string;
  pincode: string;
}

export type OrderStatus =
  | 'PENDING'
  | 'PAID'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export type PaymentStatus =
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type PaymentProviderId = 'manual' | 'razorpay' | 'phonepe' | 'stripe';

/**
 * A provider the API says it can actually take money with. `config` carries
 * publishable values only (Razorpay key id, Stripe publishable key) — the API
 * never sends a secret, salt or webhook secret to the browser.
 */
export interface PaymentMethod {
  id: PaymentProviderId;
  label: string;
  config: Record<string, string>;
}

export interface PaymentMethods {
  mode: 'test' | 'live';
  methods: PaymentMethod[];
}

/** How the browser reaches the gateway after a charge is opened. */
export interface PaymentIntent {
  provider: PaymentProviderId;
  mode: 'test' | 'live';
  orderId: string;
  reference: string;
  amount: string;
  currency: string;
  handoff: 'none' | 'redirect' | 'sdk';
  redirectUrl?: string;
  sdk?: Record<string, string | number>;
}

export interface PaymentConfirmation {
  order: Order;
  payment: { status: PaymentStatus };
  outcome: 'confirmed' | 'already-recorded' | 'amount-mismatch' | 'not-permitted' | 'pending';
}

export interface OrderItem {
  id: string;
  productId: string;
  name: string;
  size: string;
  quantity: number;
  unitPrice: string | number;
  image?: string | null;
}

export interface Payment {
  id: string;
  provider: string;
  status: PaymentStatus;
  amount: string | number;
  reference?: string | null;
}

export interface Order {
  id: string;
  number: string;
  status: OrderStatus;
  email: string;
  phone?: string | null;
  subtotal: string | number;
  shipping: string | number;
  tax: string | number;
  total: string | number;
  currency: string;
  items: OrderItem[];
  address?: Address | null;
  payment?: Payment | null;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role: 'CUSTOMER' | 'ADMIN';
}

export interface CustomizationSelection {
  wash: string;
  stitch: string;
  patch: string;
  embroidery: string;
  fit: string;
  buttons: string;
  backPocket: string;
}

export interface CustomizationOption {
  id: string;
  label: string;
  /** Hex or CSS colour used to render the live preview swatch. */
  swatch?: string;
  priceDelta?: number;
}

export interface CustomizationGroup {
  key: keyof CustomizationSelection;
  label: string;
  options: CustomizationOption[];
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type ToastKind = 'success' | 'error' | 'info';

/**
 * Admin-side types. Money and dates arrive from the API as strings (Decimal is
 * serialised fixed-2, dates as ISO) — coerce before doing maths.
 */
import type { Address, OrderStatus, PaymentStatus, Product, User } from './index';

export type Money = string;
export type Iso = string;

/**
 * Payment configuration as admin sees it: which gateways are enabled, which are
 * ready, and the *name* of anything still missing. The API never returns a key,
 * salt, secret or webhook secret — those are server-side environment only, and
 * there is no endpoint that writes them.
 */
export interface AdminPaymentProvider {
  id: 'manual' | 'razorpay' | 'phonepe' | 'stripe';
  label: string;
  selected: boolean;
  configured: boolean;
  available: boolean;
  /** Missing/contradictory variable names. Never values. */
  configErrors: string[];
  capabilities: { refunds: boolean; webhooks: boolean; statusFetch: boolean };
  webhookUrl: string | null;
}

export interface AdminPaymentConfig {
  selection: string[];
  mode: 'test' | 'live';
  returnOrigin: string;
  providers: AdminPaymentProvider[];
  transitions: Record<PaymentStatus, PaymentStatus[]>;
  totals: {
    status: PaymentStatus;
    provider: string;
    count: number;
    amount: Money | null;
    refunded: Money | null;
  }[];
  recentEvents: {
    id: string;
    provider: string;
    type: string;
    result: string;
    detail?: string | null;
    createdAt: Iso;
    orderId: string | null;
    orderNumber: string | null;
  }[];
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

export type Priority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type ProductionStatus =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'ON_HOLD'
  | 'COMPLETED'
  | 'CANCELLED';

export type StageStatus = 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'BLOCKED' | 'SKIPPED';

export type DurationUnit = 'MINUTES' | 'HOURS' | 'DAYS';

export type CartActivityStatus = 'ACTIVE' | 'ABANDONED' | 'CONVERTED';

// ── Categories ──────────────────────────────────────────────────────────────

export interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  image?: string | null;
  position: number;
  isActive: boolean;
  isFeatured: boolean;
  archivedAt?: Iso | null;
  productCount?: number;
  createdAt: Iso;
  updatedAt: Iso;
}

// ── Products ────────────────────────────────────────────────────────────────

export interface AdminProductImage {
  id?: string;
  url: string;
  alt?: string | null;
  position?: number;
}

export interface AdminInventoryRow {
  id?: string;
  size: string;
  quantity: number;
}

export interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  shortDescription?: string | null;
  sku?: string | null;
  story?: string | null;
  fabric?: string | null;
  fit?: string | null;
  care?: string | null;
  shipping?: string | null;
  price: Money;
  comparePrice?: Money | null;
  currency: string;
  color?: string | null;
  isLimited: boolean;
  isFeatured: boolean;
  isActive: boolean;
  archivedAt?: Iso | null;
  position: number;
  editionNo?: number | null;
  categoryId?: string | null;
  category?: { id: string; name: string; slug: string } | null;
  images?: AdminProductImage[];
  sizes?: { id: string; size: string; position: number }[];
  inventory?: AdminInventoryRow[];
  processes?: AdminProductProcess[];
  /** Null means no inventory rows exist, i.e. unlimited. */
  stock?: number | null;
  orderCount?: number;
  processCount?: number;
  createdAt: Iso;
  updatedAt: Iso;
}

// ── Process stages ──────────────────────────────────────────────────────────

export interface AdminProcessStage {
  id: string;
  name: string;
  slug: string;
  description?: string | null;
  /** Minutes, for one unit. */
  defaultDuration: number;
  durationUnit: DurationUnit;
  defaultCost: Money;
  isActive: boolean;
  sortOrder: number;
  archivedAt?: Iso | null;
  productCount?: number;
}

export interface AdminProductProcess {
  id: string;
  productId: string;
  stageId: string;
  sortOrder: number;
  /** Null = inherit the stage default. */
  duration?: number | null;
  cost?: Money | null;
  isMandatory: boolean;
  notes?: string | null;
  stage: Pick<
    AdminProcessStage,
    'id' | 'name' | 'slug' | 'defaultDuration' | 'defaultCost' | 'durationUnit' | 'isActive'
  >;
  effectiveDuration?: number;
  effectiveCost?: Money;
}

export interface ProductProcessConfig {
  processes: AdminProductProcess[];
  /** Per-unit totals. */
  totalDuration: number;
  totalCost: Money;
  product?: { id: string; name: string };
}

// ── Customers ───────────────────────────────────────────────────────────────

export interface AdminCustomerRow {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  isActive: boolean;
  createdAt: Iso;
  lastLoginAt?: Iso | null;
  orderCount: number;
  totalSpent: Money;
  cartItemCount: number;
  cartValue: Money;
  cartUpdatedAt?: Iso | null;
}

export interface AdminCustomerDetail {
  customer: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    role: 'CUSTOMER' | 'ADMIN';
    isActive: boolean;
    createdAt: Iso;
    updatedAt: Iso;
    lastLoginAt?: Iso | null;
    addresses: Address[];
    cart?: {
      id: string;
      updatedAt: Iso;
      items: {
        id: string;
        size: string;
        quantity: number;
        product: Pick<Product, 'id' | 'name' | 'slug' | 'price'> & {
          images?: { url: string }[];
        };
      }[];
    } | null;
    orders: {
      id: string;
      number: string;
      status: OrderStatus;
      total: Money;
      currency: string;
      createdAt: Iso;
      requiredBy?: Iso | null;
      itemCount: number;
      payment?: { status: PaymentStatus } | null;
    }[];
    wishlist?: {
      items: {
        id: string;
        createdAt: Iso;
        product: Pick<Product, 'id' | 'name' | 'slug' | 'price'>;
      }[];
    } | null;
  };
  stats: {
    orderCount: number;
    totalSpent: Money;
    cartItemCount: number;
    cartValue: Money;
  };
  activity: AdminActivity[];
}

// ── Carts ───────────────────────────────────────────────────────────────────

export interface AdminCart {
  id: string;
  status: CartActivityStatus;
  customer: {
    id: string;
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    orderCount: number;
  };
  items: {
    id: string;
    size: string;
    quantity: number;
    product: { id: string; name: string; slug: string; price: Money; images?: { url: string }[] };
  }[];
  itemCount: number;
  value: Money;
  createdAt: Iso;
  updatedAt: Iso;
}

// ── Orders ──────────────────────────────────────────────────────────────────

export interface AdminOrderRow {
  id: string;
  number: string;
  status: OrderStatus;
  priority: Priority;
  email: string;
  phone?: string | null;
  total: Money;
  currency: string;
  createdAt: Iso;
  requiredBy?: Iso | null;
  deliveryDueAt?: Iso | null;
  user?: { id: string; firstName?: string | null; lastName?: string | null; email: string } | null;
  payment?: { status: PaymentStatus; provider: string; reference?: string | null } | null;
  itemCount: number;
  productionStatus: ProductionStatus | 'NONE';
  productionProgress: number;
  isOverdue: boolean;
  isDueSoon: boolean;
}

export interface AdminProductionStage {
  id: string;
  name: string;
  sortOrder: number;
  status: StageStatus;
  estimatedMinutes: number;
  actualMinutes?: number | null;
  cost: Money;
  isMandatory: boolean;
  startedAt?: Iso | null;
  completedAt?: Iso | null;
  assignee?: string | null;
  notes?: string | null;
}

export interface AdminProductionPlan {
  id: string;
  quantity: number;
  status: ProductionStatus;
  estimatedMinutes: number;
  estimatedCost: Money;
  estimatedStartAt?: Iso | null;
  estimatedCompletionAt?: Iso | null;
  deadlineAt?: Iso | null;
  actualStartAt?: Iso | null;
  actualCompletionAt?: Iso | null;
  notes?: string | null;
  stages: AdminProductionStage[];
  progress: number;
  isOverdue: boolean;
  isDueSoon: boolean;
  daysRemaining: number | null;
  remainingMinutes?: number;
  currentStage?: { id: string; name: string; status: StageStatus } | null;
  order?: {
    id: string;
    number: string;
    status: OrderStatus;
    priority: Priority;
    email: string;
    createdAt: Iso;
    user?: { id: string; firstName?: string | null; lastName?: string | null; email: string } | null;
  };
  orderItem?: { id: string; name: string; size: string; quantity: number };
  product?: { id: string; name: string; slug: string };
  createdAt?: Iso;
}

export interface AdminOrderDetail {
  order: {
    id: string;
    number: string;
    status: OrderStatus;
    priority: Priority;
    email: string;
    phone?: string | null;
    subtotal: Money;
    shipping: Money;
    tax: Money;
    total: Money;
    currency: string;
    createdAt: Iso;
    updatedAt: Iso;
    requiredBy?: Iso | null;
    deliveryDueAt?: Iso | null;
    adminNotes?: string | null;
    cancelledAt?: Iso | null;
    address?: Address | null;
    payment?: {
      id: string;
      provider: string;
      status: PaymentStatus;
      amount: Money;
      currency: string;
      reference?: string | null;
      /** Gateway handles, for reconciling against a provider statement. */
      providerOrderId?: string | null;
      providerPaymentId?: string | null;
      mode?: string | null;
      failureReason?: string | null;
      refundedAmount: Money;
      paidAt?: Iso | null;
      refundedAt?: Iso | null;
    } | null;
    coupon?: { code: string; percentOff?: number | null; amountOff?: Money | null } | null;
    user?: {
      id: string;
      email: string;
      firstName?: string | null;
      lastName?: string | null;
      phone?: string | null;
      createdAt: Iso;
      _count?: { orders: number };
    } | null;
    items: {
      id: string;
      productId: string;
      name: string;
      image?: string | null;
      size: string;
      quantity: number;
      unitPrice: Money;
      product?: { id: string; name: string; slug: string };
      production?: AdminProductionPlan | null;
    }[];
    events: {
      id: string;
      label: string;
      detail?: string | null;
      actorEmail?: string | null;
      createdAt: Iso;
    }[];
  };
  productionStatus: ProductionStatus | 'NONE';
}

// ── Dashboard ───────────────────────────────────────────────────────────────

export interface DashboardAlertPlan {
  id: string;
  orderId: string;
  orderNumber: string;
  customer: string;
  product: string;
  quantity: number;
  currentStage?: string | null;
  progress: number;
  deadlineAt?: Iso | null;
  isOverdue: boolean;
  isDueSoon: boolean;
  daysRemaining: number | null;
}

export interface AdminDashboard {
  customers: { total: number; today: number; thisWeek: number; thisMonth: number };
  products: {
    total: number;
    active: number;
    inactive: number;
    featured: number;
    outOfStock: number;
  };
  categories: { total: number; active: number };
  carts: {
    active: number;
    abandoned: number;
    withItems: number;
    totalItems: number;
    estimatedValue: Money;
  };
  orders: { total: number; today: number; byStatus: Record<string, number> };
  production: {
    inProduction: number;
    notStarted: number;
    dueToday: number;
    dueTomorrow: number;
    overdue: number;
    dueSoon: number;
    completedToday: number;
    warningDays: number;
  };
  revenue: {
    today: Money;
    thisWeek: Money;
    thisMonth: Money;
    total: Money;
    currency: string;
    basis: string;
  };
  alerts: {
    overdue: DashboardAlertPlan[];
    dueSoon: DashboardAlertPlan[];
    activeProduction: DashboardAlertPlan[];
    newOrders: {
      id: string;
      number: string;
      status: OrderStatus;
      total: Money;
      currency: string;
      email: string;
      createdAt: Iso;
      itemCount: number;
      user?: { firstName?: string | null; lastName?: string | null } | null;
      payment?: { status: PaymentStatus } | null;
    }[];
    newCustomers: {
      id: string;
      email: string;
      firstName?: string | null;
      lastName?: string | null;
      phone?: string | null;
      createdAt: Iso;
      orderCount: number;
    }[];
  };
}

// ── Activity & settings ─────────────────────────────────────────────────────

export interface AdminActivity {
  id: string;
  actorId?: string | null;
  actorEmail?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  summary: string;
  meta?: unknown;
  createdAt: Iso;
}

export interface AdminSettings {
  productionWarningDays: number;
  productionMinutesPerDay: number;
  workingDays: number[];
  deliveryBufferDays: number;
  defaultProcessDuration: number;
  currency: string;
  timezone: string;
  orderNumberPrefix: string;
  defaultOrderStatus: 'PENDING' | 'CONFIRMED';
  defaultCategoryVisible: boolean;
  cartAbandonedAfterMinutes: number;
}

export type AdminUser = User;

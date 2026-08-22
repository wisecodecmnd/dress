import type {
  AdminActivity,
  AdminCart,
  AdminCategory,
  AdminCustomerDetail,
  AdminCustomerRow,
  AdminDashboard,
  AdminOrderDetail,
  AdminOrderRow,
  AdminPaymentConfig,
  AdminProcessStage,
  AdminProduct,
  AdminProductionPlan,
  AdminSettings,
  AdminUser,
  Paged,
  ProductProcessConfig,
} from '../types/admin';

/**
 * Admin API client. Mirrors src/services/api.ts — same base URL resolution,
 * same httpOnly-cookie session — but every path sits under /api/admin, which
 * the server gates on the ADMIN role.
 */
const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

export class AdminApiError extends Error {
  status: number;
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'AdminApiError';
    this.status = status;
    this.details = details;
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}/api/admin${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    ...init,
  });

  const isJson = res.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await res.json().catch(() => null) : null;

  if (!res.ok) {
    const message =
      (payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : null) ?? `Request failed (${res.status})`;
    throw new AdminApiError(message, res.status, payload);
  }

  return payload as T;
}

/** Drops undefined/empty values so the query string stays clean. */
export function qs(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'all') continue;
    search.set(key, String(value));
  }

  const out = search.toString();
  return out ? `?${out}` : '';
}

export const adminApi = {
  // ── Auth ─────────────────────────────────────────────────────────────────
  login: (email: string, password: string) =>
    request<{ user: AdminUser }>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<{ user: AdminUser }>('/me'),
  logout: () => request<{ ok: true }>('/logout', { method: 'POST' }),

  // ── Dashboard ────────────────────────────────────────────────────────────
  dashboard: () => request<AdminDashboard>('/dashboard'),

  // ── Categories ───────────────────────────────────────────────────────────
  categories: (params: Record<string, unknown> = {}) =>
    request<Paged<AdminCategory>>(`/categories${qs(params)}`),
  createCategory: (body: Partial<AdminCategory>) =>
    request<{ category: AdminCategory }>('/categories', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateCategory: (id: string, body: Partial<AdminCategory>) =>
    request<{ category: AdminCategory }>(`/categories/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteCategory: (id: string) =>
    request<{ ok?: true; archived: boolean }>(`/categories/${id}`, { method: 'DELETE' }),
  restoreCategory: (id: string) =>
    request<{ category: AdminCategory }>(`/categories/${id}/restore`, { method: 'POST' }),
  reorderCategories: (order: { id: string; position: number }[]) =>
    request<{ ok: true }>('/categories/reorder', {
      method: 'POST',
      body: JSON.stringify({ order }),
    }),

  // ── Products ─────────────────────────────────────────────────────────────
  products: (params: Record<string, unknown> = {}) =>
    request<Paged<AdminProduct>>(`/products${qs(params)}`),
  product: (id: string) =>
    request<{ product: AdminProduct; stock: number | null }>(`/products/${id}`),
  createProduct: (body: Record<string, unknown>) =>
    request<{ product: AdminProduct }>('/products', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateProduct: (id: string, body: Record<string, unknown>) =>
    request<{ product: AdminProduct }>(`/products/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteProduct: (id: string) =>
    request<{ ok?: true; archived: boolean }>(`/products/${id}`, { method: 'DELETE' }),
  restoreProduct: (id: string) =>
    request<{ product: AdminProduct }>(`/products/${id}/restore`, { method: 'POST' }),

  // ── Product process configuration ────────────────────────────────────────
  productProcesses: (id: string) =>
    request<ProductProcessConfig>(`/products/${id}/processes`),
  attachProcess: (
    id: string,
    body: { stageId: string; duration?: number | null; cost?: number | null; isMandatory?: boolean },
  ) =>
    request<ProductProcessConfig>(`/products/${id}/processes`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateProductProcess: (
    id: string,
    processId: string,
    body: { duration?: number | null; cost?: number | null; isMandatory?: boolean; sortOrder?: number },
  ) =>
    request<ProductProcessConfig>(`/products/${id}/processes/${processId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  detachProcess: (id: string, processId: string) =>
    request<ProductProcessConfig>(`/products/${id}/processes/${processId}`, { method: 'DELETE' }),
  reorderProductProcesses: (id: string, order: { id: string; sortOrder: number }[]) =>
    request<ProductProcessConfig>(`/products/${id}/processes/reorder`, {
      method: 'POST',
      body: JSON.stringify({ order }),
    }),
  applyDefaultProcesses: (id: string) =>
    request<ProductProcessConfig>(`/products/${id}/processes/apply-defaults`, { method: 'POST' }),

  // ── Process stage library ────────────────────────────────────────────────
  processes: (params: Record<string, unknown> = {}) =>
    request<Paged<AdminProcessStage>>(`/processes${qs(params)}`),
  createStage: (body: Record<string, unknown>) =>
    request<{ stage: AdminProcessStage }>('/processes', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateStage: (id: string, body: Record<string, unknown>) =>
    request<{ stage: AdminProcessStage }>(`/processes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteStage: (id: string) =>
    request<{ ok?: true; archived: boolean }>(`/processes/${id}`, { method: 'DELETE' }),
  reorderStages: (order: { id: string; sortOrder: number }[]) =>
    request<{ ok: true }>('/processes/reorder', {
      method: 'POST',
      body: JSON.stringify({ order }),
    }),

  // ── Customers ────────────────────────────────────────────────────────────
  customers: (params: Record<string, unknown> = {}) =>
    request<Paged<AdminCustomerRow>>(`/customers${qs(params)}`),
  customer: (id: string) => request<AdminCustomerDetail>(`/customers/${id}`),
  updateCustomer: (id: string, body: { isActive?: boolean; phone?: string | null }) =>
    request<{ customer: { id: string; email: string; isActive: boolean } }>(`/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  // ── Carts ────────────────────────────────────────────────────────────────
  carts: (params: Record<string, unknown> = {}) =>
    request<Paged<AdminCart> & { abandonedAfterMinutes: number }>(`/carts${qs(params)}`),

  // ── Orders ───────────────────────────────────────────────────────────────
  orders: (params: Record<string, unknown> = {}) =>
    request<Paged<AdminOrderRow>>(`/orders${qs(params)}`),
  order: (id: string) => request<AdminOrderDetail>(`/orders/${id}`),
  updateOrder: (id: string, body: Record<string, unknown>) =>
    request<{ order: unknown }>(`/orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  /** Omit `amount` to refund whatever is still refundable. */
  refundOrder: (id: string, amount?: number) =>
    request<{ order: unknown; outcome: string }>(`/orders/${id}/refund`, {
      method: 'POST',
      body: JSON.stringify(amount === undefined ? {} : { amount }),
    }),

  // ── Payments (read-only; secrets are server-side environment only) ────────
  paymentConfig: () => request<AdminPaymentConfig>('/payments/config'),

  // ── Production ───────────────────────────────────────────────────────────
  production: (params: Record<string, unknown> = {}) =>
    request<Paged<AdminProductionPlan> & { warningDays: number }>(`/production${qs(params)}`),
  plan: (id: string) => request<{ plan: AdminProductionPlan }>(`/production/${id}`),
  startProduction: (id: string) =>
    request<{ plan: AdminProductionPlan }>(`/production/${id}/start`, { method: 'POST' }),
  rebuildPlan: (id: string) =>
    request<{ plan: AdminProductionPlan }>(`/production/${id}/rebuild`, { method: 'POST' }),
  updatePlan: (id: string, body: Record<string, unknown>) =>
    request<{ plan: AdminProductionPlan }>(`/production/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  updateProductionStage: (
    id: string,
    stageId: string,
    body: { status?: string; assignee?: string | null; notes?: string | null },
  ) =>
    request<{ plan: AdminProductionPlan }>(`/production/${id}/stages/${stageId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  // ── Activity & settings ──────────────────────────────────────────────────
  activity: (params: Record<string, unknown> = {}) =>
    request<Paged<AdminActivity>>(`/activity${qs(params)}`),
  settings: () => request<{ settings: AdminSettings }>('/settings'),
  updateSettings: (body: Partial<AdminSettings>) =>
    request<{ settings: AdminSettings }>('/settings', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  /** CSV download URL — hit directly so the browser handles the file. */
  exportUrl: (type: 'orders' | 'customers' | 'products' | 'production') =>
    `${BASE}/api/admin/export?type=${type}`,
};

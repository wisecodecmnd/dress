import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import { useAdminResource } from '../hooks';
import type { AdminOrderDetail } from '../../types/admin';
import {
  Badge,
  Button,
  ErrorNote,
  Field,
  Input,
  Loading,
  PageHeader,
  Panel,
  Select,
  Textarea,
  humanise,
  statusTone,
} from '../components/ui';
import {
  customerName,
  deadlineLabel,
  formatDateOnly,
  formatDateTime,
  formatDuration,
  formatPrice,
  toDateInput,
} from '../format';
import ProductionPlanPanel from '../components/ProductionPlanPanel';

const ORDER_STATUSES = [
  'PENDING',
  'CONFIRMED',
  'PAID',
  'PROCESSING',
  'IN_PRODUCTION',
  'QUALITY_CHECK',
  'READY',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
];

const PAYMENT_STATUSES = [
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
];

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refresh } = useAdminResource<AdminOrderDetail>(
    () => adminApi.order(id!),
    [id],
  );

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  if (loading && !data) return <Loading rows={10} />;
  if (error) return <ErrorNote message={error} onRetry={refresh} />;
  if (!data) return null;

  const { order } = data;

  const patch = async (body: Record<string, unknown>) => {
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.updateOrder(order.id, body);
      refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not update');
    } finally {
      setSaving(false);
    }
  };

  /**
   * Refunds through the gateway that took the money. The server recomputes what
   * is still refundable, so this can only ever refund the remainder — a second
   * click is rejected rather than doubling up.
   */
  const refund = async () => {
    if (!window.confirm('Refund the outstanding amount on this order?')) return;
    setSaving(true);
    setSaveError(null);
    try {
      await adminApi.refundOrder(order.id);
      refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not refund');
    } finally {
      setSaving(false);
    }
  };

  const payment = order.payment;
  const refundable =
    payment != null &&
    ['CAPTURED', 'PARTIALLY_REFUNDED'].includes(payment.status) &&
    Number(payment.refundedAmount ?? 0) < Number(payment.amount);

  const anyOverdue = order.items.some((i) => i.production?.isOverdue);

  return (
    <>
      <Helmet>
        <title>{order.number} — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Link
        to="/admin/orders"
        className="mb-4 inline-flex items-center gap-1 text-sm text-fog hover:text-pearl"
      >
        <ArrowLeft size={14} /> All orders
      </Link>

      <PageHeader
        title={`Order ${order.number}`}
        subtitle={`Placed ${formatDateTime(order.createdAt)}`}
        actions={
          <>
            <Badge tone={statusTone(order.status)}>{humanise(order.status)}</Badge>
            {order.payment && (
              <Badge tone={statusTone(order.payment.status)}>
                {humanise(order.payment.status)}
              </Badge>
            )}
          </>
        }
      />

      {anyOverdue && (
        <div className="mb-6 flex items-center gap-2 rounded border border-red-500/50 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle size={16} />
          This order has production past its deadline.
        </div>
      )}

      {saveError && (
        <div className="mb-4">
          <ErrorNote message={saveError} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Items">
            <ul className="divide-y divide-stone/25">
              {order.items.map((item) => (
                <li key={item.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      {item.image && (
                        <img
                          src={item.image}
                          alt=""
                          className="h-12 w-12 flex-shrink-0 rounded object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        {item.product ? (
                          <Link
                            to={`/admin/products/${item.product.id}`}
                            className="block truncate text-sm hover:underline"
                          >
                            {item.name}
                          </Link>
                        ) : (
                          <p className="truncate text-sm">{item.name}</p>
                        )}
                        <p className="text-xs text-fog">
                          Size {item.size} · × {item.quantity} ·{' '}
                          {formatPrice(item.unitPrice, order.currency)} each
                        </p>
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-sm">
                      {formatPrice(Number(item.unitPrice) * item.quantity, order.currency)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>

            <dl className="space-y-2 border-t border-stone/40 px-4 py-3 text-sm">
              <Money label="Subtotal" value={order.subtotal} currency={order.currency} />
              <Money label="Shipping" value={order.shipping} currency={order.currency} />
              <Money label="Tax" value={order.tax} currency={order.currency} />
              {order.coupon && (
                <div className="flex justify-between text-xs text-fog">
                  <dt>Coupon</dt>
                  <dd>{order.coupon.code}</dd>
                </div>
              )}
              <div className="flex justify-between border-t border-stone/40 pt-2 text-base font-medium">
                <dt>Total</dt>
                <dd>{formatPrice(order.total, order.currency)}</dd>
              </div>
            </dl>
          </Panel>

          {/* One production plan per ordered line */}
          {order.items.map((item) =>
            item.production ? (
              <ProductionPlanPanel
                key={item.production.id}
                plan={item.production}
                title={`Production — ${item.name} × ${item.quantity}`}
                onChanged={refresh}
              />
            ) : null,
          )}

          <Panel title="Timeline">
            {order.events.length === 0 ? (
              <p className="p-4 text-sm text-fog">No events recorded</p>
            ) : (
              <ol className="divide-y divide-stone/25">
                {order.events.map((event) => (
                  <li key={event.id} className="px-4 py-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm">{event.label}</p>
                      <span className="text-xs text-fog">{formatDateTime(event.createdAt)}</span>
                    </div>
                    {event.detail && <p className="text-xs text-fog">{event.detail}</p>}
                    {event.actorEmail && (
                      <p className="text-xs text-fog">by {event.actorEmail}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Update order">
            <div className="space-y-4 p-4">
              <Field label="Order status">
                <Select
                  value={order.status}
                  disabled={saving}
                  onChange={(e) => patch({ status: e.target.value })}
                >
                  {ORDER_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {humanise(s)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Payment status">
                <Select
                  value={order.payment?.status ?? 'PENDING'}
                  disabled={saving}
                  onChange={(e) => patch({ paymentStatus: e.target.value })}
                >
                  {PAYMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {humanise(s)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Payment reference">
                <Input
                  defaultValue={order.payment?.reference ?? ''}
                  disabled={saving}
                  placeholder="Provider transaction id"
                  onBlur={(e) => {
                    const next = e.target.value.trim() || null;
                    if (next === (order.payment?.reference ?? null)) return;
                    void patch({ paymentReference: next });
                  }}
                />
              </Field>

              {payment && (
                <div className="space-y-1 rounded border border-white/10 p-3 text-xs text-white/50">
                  <p>
                    Gateway: <span className="text-white/80">{payment.provider}</span>
                    {payment.mode ? ` · ${payment.mode}` : ''}
                  </p>
                  {payment.providerPaymentId && (
                    <p className="break-all">Provider payment: {payment.providerPaymentId}</p>
                  )}
                  {Number(payment.refundedAmount ?? 0) > 0 && (
                    <p>
                      Refunded: {payment.currency} {payment.refundedAmount}
                    </p>
                  )}
                  {payment.paidAt && <p>Paid {formatDateTime(payment.paidAt)}</p>}
                  {payment.failureReason && (
                    <p className="text-amber-300">Last failure: {payment.failureReason}</p>
                  )}
                  {refundable && (
                    <Button variant="ghost" disabled={saving} onClick={refund} className="mt-2">
                      Refund outstanding amount
                    </Button>
                  )}
                </div>
              )}

              <Field label="Priority">
                <Select
                  value={order.priority}
                  disabled={saving}
                  onChange={(e) => patch({ priority: e.target.value })}
                >
                  {['LOW', 'NORMAL', 'HIGH', 'URGENT'].map((p) => (
                    <option key={p} value={p}>
                      {humanise(p)}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Required completion date">
                <Input
                  type="date"
                  defaultValue={toDateInput(order.requiredBy)}
                  disabled={saving}
                  onChange={(e) =>
                    patch({ requiredBy: e.target.value ? new Date(e.target.value).toISOString() : null })
                  }
                />
              </Field>

              <Field label="Delivery due date">
                <Input
                  type="date"
                  defaultValue={toDateInput(order.deliveryDueAt)}
                  disabled={saving}
                  onChange={(e) =>
                    patch({
                      deliveryDueAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                    })
                  }
                />
              </Field>

              <Field label="Internal notes">
                <Textarea
                  rows={3}
                  defaultValue={order.adminNotes ?? ''}
                  disabled={saving}
                  onBlur={(e) => {
                    const next = e.target.value.trim() || null;
                    if (next === (order.adminNotes ?? null)) return;
                    void patch({ adminNotes: next });
                  }}
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Customer">
            <div className="space-y-3 p-4 text-sm">
              {order.user ? (
                <Link
                  to={`/admin/customers/${order.user.id}`}
                  className="block font-medium hover:underline"
                >
                  {customerName(order.user, order.email)}
                </Link>
              ) : (
                <p className="font-medium">Guest checkout</p>
              )}
              <p className="text-mist">{order.email}</p>
              {order.phone && <p className="text-mist">{order.phone}</p>}
              {order.user?._count && (
                <p className="text-xs text-fog">
                  {order.user._count.orders} order(s) all time · customer since{' '}
                  {formatDateOnly(order.user.createdAt)}
                </p>
              )}
            </div>
          </Panel>

          <Panel title="Shipping address">
            {order.address ? (
              <div className="space-y-0.5 p-4 text-sm">
                <p>{order.address.line1}</p>
                {order.address.line2 && <p>{order.address.line2}</p>}
                <p className="text-mist">
                  {order.address.city}, {order.address.state} {order.address.pincode}
                </p>
                <p className="text-xs text-fog">{order.address.country}</p>
              </div>
            ) : (
              <p className="p-4 text-sm text-fog">No address on file</p>
            )}
          </Panel>

          <Panel title="Deadlines">
            <dl className="space-y-3 p-4 text-sm">
              <Row label="Required by" value={formatDateOnly(order.requiredBy)} />
              <Row label="Delivery due" value={formatDateOnly(order.deliveryDueAt)} />
              {order.items.map((item) =>
                item.production ? (
                  <div key={item.production.id} className="border-t border-stone/40 pt-2">
                    <p className="text-xs uppercase tracking-wide text-fog">{item.name}</p>
                    <p className="mt-1 text-xs">
                      Est. {formatDuration(item.production.estimatedMinutes)} ·{' '}
                      <span
                        className={
                          item.production.isOverdue
                            ? 'text-red-300'
                            : item.production.isDueSoon
                              ? 'text-amber-300'
                              : ''
                        }
                      >
                        {deadlineLabel(item.production.daysRemaining, item.production.isOverdue)}
                      </span>
                    </p>
                  </div>
                ) : null,
              )}
            </dl>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Money({
  label,
  value,
  currency,
}: {
  label: string;
  value: string;
  currency: string;
}) {
  return (
    <div className="flex justify-between text-mist">
      <dt>{label}</dt>
      <dd>{formatPrice(value, currency)}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-xs uppercase tracking-wide text-fog">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

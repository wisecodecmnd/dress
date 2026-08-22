import { Link, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import { useAdminResource } from '../hooks';
import type { AdminCustomerDetail } from '../../types/admin';
import {
  Badge,
  Button,
  ErrorNote,
  Loading,
  PageHeader,
  Panel,
  StatCard,
  humanise,
  statusTone,
} from '../components/ui';
import { customerName, formatDateOnly, formatDateTime, formatPrice, formatRelative } from '../format';

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, error, refresh } = useAdminResource<AdminCustomerDetail>(
    () => adminApi.customer(id!),
    [id],
  );

  if (loading && !data) return <Loading rows={8} />;
  if (error) return <ErrorNote message={error} onRetry={refresh} />;
  if (!data) return null;

  const { customer, stats, activity } = data;
  const cartItems = customer.cart?.items ?? [];

  const toggleSuspend = async () => {
    const suspending = customer.isActive;
    const message = suspending
      ? `Suspend ${customer.email}? They will not be able to sign in.`
      : `Reactivate ${customer.email}?`;
    if (!window.confirm(message)) return;

    await adminApi.updateCustomer(customer.id, { isActive: !customer.isActive });
    refresh();
  };

  return (
    <>
      <Helmet>
        <title>{customerName(customer, customer.email)} — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Link
        to="/admin/customers"
        className="mb-4 inline-flex items-center gap-1 text-sm text-fog hover:text-pearl"
      >
        <ArrowLeft size={14} /> All customers
      </Link>

      <PageHeader
        title={customerName(customer, customer.email)}
        subtitle={customer.email}
        actions={
          <Button variant={customer.isActive ? 'danger' : 'secondary'} onClick={toggleSuspend}>
            {customer.isActive ? 'Suspend account' : 'Reactivate account'}
          </Button>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Orders" value={stats.orderCount} />
        <StatCard label="Total spent" value={formatPrice(stats.totalSpent)} />
        <StatCard
          label="Cart items"
          value={stats.cartItemCount}
          tone={stats.cartItemCount > 0 ? 'good' : 'neutral'}
        />
        <StatCard label="Cart value" value={formatPrice(stats.cartValue)} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Order history">
            {customer.orders.length === 0 ? (
              <p className="p-4 text-sm text-fog">No orders yet</p>
            ) : (
              <ul className="divide-y divide-stone/25">
                {customer.orders.map((order) => (
                  <li key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <Link
                        to={`/admin/orders/${order.id}`}
                        className="block text-sm hover:underline"
                      >
                        {order.number}
                      </Link>
                      <p className="text-xs text-fog">
                        {formatDateOnly(order.createdAt)} · {order.itemCount} item(s)
                        {order.requiredBy ? ` · due ${formatDateOnly(order.requiredBy)}` : ''}
                      </p>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <span className="text-sm">{formatPrice(order.total, order.currency)}</span>
                      <Badge tone={statusTone(order.status)}>{humanise(order.status)}</Badge>
                      {order.payment && (
                        <Badge tone={statusTone(order.payment.status)}>
                          {humanise(order.payment.status)}
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Current cart"
            actions={
              customer.cart?.updatedAt ? (
                <span className="text-xs text-fog">
                  updated {formatRelative(customer.cart.updatedAt)}
                </span>
              ) : undefined
            }
          >
            {cartItems.length === 0 ? (
              <p className="p-4 text-sm text-fog">Cart is empty</p>
            ) : (
              <ul className="divide-y divide-stone/25">
                {cartItems.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-3">
                      {item.product.images?.[0]?.url && (
                        <img
                          src={item.product.images[0].url}
                          alt=""
                          className="h-10 w-10 flex-shrink-0 rounded object-cover"
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm">{item.product.name}</p>
                        <p className="text-xs text-fog">
                          Size {item.size} · × {item.quantity}
                        </p>
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-sm">
                      {formatPrice(Number(item.product.price) * item.quantity)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Activity timeline">
            {activity.length === 0 ? (
              <p className="p-4 text-sm text-fog">No recorded activity</p>
            ) : (
              <ul className="divide-y divide-stone/25">
                {activity.map((entry) => (
                  <li key={entry.id} className="px-4 py-2.5">
                    <p className="text-sm">{entry.summary}</p>
                    <p className="text-xs text-fog">
                      {entry.action} · {formatRelative(entry.createdAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Profile">
            <dl className="space-y-3 p-4 text-sm">
              <Row label="Email" value={customer.email} />
              <Row label="Phone" value={customer.phone ?? '—'} />
              <Row label="Registered" value={formatDateTime(customer.createdAt)} />
              <Row
                label="Last login"
                value={customer.lastLoginAt ? formatDateTime(customer.lastLoginAt) : 'Never'}
              />
              <Row label="Account" value={customer.isActive ? 'Active' : 'Suspended'} />
            </dl>
            <p className="border-t border-stone/40 px-4 py-3 text-xs text-fog">
              Passwords are stored only as bcrypt hashes and are never retrievable here.
            </p>
          </Panel>

          <Panel title="Addresses">
            {customer.addresses.length === 0 ? (
              <p className="p-4 text-sm text-fog">No saved addresses</p>
            ) : (
              <ul className="divide-y divide-stone/25">
                {customer.addresses.map((address) => (
                  <li key={address.id} className="px-4 py-3 text-sm">
                    {address.label && <p className="text-xs uppercase text-fog">{address.label}</p>}
                    <p>{address.line1}</p>
                    {address.line2 && <p>{address.line2}</p>}
                    <p className="text-mist">
                      {address.city}, {address.state} {address.pincode}
                    </p>
                    <p className="text-xs text-fog">{address.country}</p>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          {(customer.wishlist?.items?.length ?? 0) > 0 && (
            <Panel title="Wishlist">
              <ul className="divide-y divide-stone/25">
                {customer.wishlist!.items.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 px-4 py-2.5">
                    <span className="truncate text-sm">{item.product.name}</span>
                    <span className="flex-shrink-0 text-xs text-fog">
                      {formatPrice(item.product.price)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>
    </>
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

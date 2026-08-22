import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { RefreshCw } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import { useAdminResource } from '../hooks';
import type { AdminDashboard, DashboardAlertPlan } from '../../types/admin';
import {
  Badge,
  Button,
  ErrorNote,
  Loading,
  PageHeader,
  Panel,
  ProgressBar,
  StatCard,
  statusTone,
  humanise,
} from '../components/ui';
import { customerName, deadlineLabel, formatDateOnly, formatPrice, formatRelative } from '../format';

/** Refreshed every 60s — there is no realtime transport, so this is honest polling. */
const REFRESH_MS = 60_000;

export default function Dashboard() {
  const { data, loading, error, refresh } = useAdminResource<AdminDashboard>(
    () => adminApi.dashboard(),
    [],
    { refreshMs: REFRESH_MS },
  );

  if (loading && !data) return <Loading rows={8} />;
  if (error && !data) return <ErrorNote message={error} onRetry={refresh} />;
  if (!data) return null;

  const { customers, products, categories, carts, orders, production, revenue, alerts } = data;
  const currency = revenue.currency;

  return (
    <>
      <Helmet>
        <title>Dashboard — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <PageHeader
        title="Dashboard"
        subtitle="Live operational state. Refreshes every minute."
        actions={
          <Button onClick={refresh} variant="secondary">
            <RefreshCw size={14} /> Refresh
          </Button>
        }
      />

      {/* Priority alerts first — this is what the admin acts on. */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="🔴 Overdue"
          value={production.overdue}
          hint="Deadline has passed"
          tone={production.overdue > 0 ? 'bad' : 'neutral'}
        />
        <StatCard
          label="🟠 Due soon"
          value={production.dueSoon}
          hint={`Within ${production.warningDays} days`}
          tone={production.dueSoon > 0 ? 'warn' : 'neutral'}
        />
        <StatCard
          label="🟢 In production"
          value={production.inProduction}
          hint={`${production.notStarted} not started`}
          tone="good"
        />
        <StatCard
          label="🔵 Orders today"
          value={orders.today}
          hint={`${orders.total} all time`}
        />
      </div>

      {production.overdue > 0 && (
        <div className="mb-6">
          <AlertList
            title="🔴 Overdue orders"
            plans={alerts.overdue}
            tone="bad"
            empty="Nothing overdue"
          />
        </div>
      )}

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <AlertList
          title="🟠 Due soon"
          plans={alerts.dueSoon}
          tone="warn"
          empty="Nothing due in the warning window"
        />
        <AlertList
          title="🟢 Active production"
          plans={alerts.activeProduction}
          tone="good"
          empty="Nothing in production"
        />
      </div>

      {/* Counters */}
      <h2 className="mb-3 text-meta uppercase text-fog">Customers</h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total registered" value={customers.total} />
        <StatCard label="New today" value={customers.today} />
        <StatCard label="New this week" value={customers.thisWeek} />
        <StatCard label="New this month" value={customers.thisMonth} />
      </div>

      <h2 className="mb-3 text-meta uppercase text-fog">Catalogue</h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Products" value={products.total} hint={`${products.active} active`} />
        <StatCard
          label="Out of stock"
          value={products.outOfStock}
          tone={products.outOfStock > 0 ? 'warn' : 'neutral'}
        />
        <StatCard label="Featured" value={products.featured} />
        <StatCard label="Categories" value={categories.total} hint={`${categories.active} active`} />
        <StatCard label="Disabled products" value={products.inactive} />
      </div>

      <h2 className="mb-3 text-meta uppercase text-fog">Cart activity</h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active carts" value={carts.active} hint="Recently touched" tone="good" />
        <StatCard
          label="Abandoned carts"
          value={carts.abandoned}
          tone={carts.abandoned > 0 ? 'warn' : 'neutral'}
        />
        <StatCard label="Items in carts" value={carts.totalItems} />
        <StatCard label="Estimated value" value={formatPrice(carts.estimatedValue, currency)} />
      </div>

      <h2 className="mb-3 text-meta uppercase text-fog">Production</h2>
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Due today" value={production.dueToday} />
        <StatCard label="Due tomorrow" value={production.dueTomorrow} />
        <StatCard label="Completed today" value={production.completedToday} tone="good" />
        <StatCard label="Not started" value={production.notStarted} />
        <StatCard
          label="Overdue"
          value={production.overdue}
          tone={production.overdue > 0 ? 'bad' : 'neutral'}
        />
      </div>

      <h2 className="mb-1 text-meta uppercase text-fog">Revenue</h2>
      <p className="mb-3 text-xs text-fog">
        Counted from captured payments only. With no payment provider configured, orders stay
        pending and these read zero.
      </p>
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Today" value={formatPrice(revenue.today, currency)} />
        <StatCard label="This week" value={formatPrice(revenue.thisWeek, currency)} />
        <StatCard label="This month" value={formatPrice(revenue.thisMonth, currency)} />
        <StatCard label="All time" value={formatPrice(revenue.total, currency)} />
      </div>

      <h2 className="mb-3 text-meta uppercase text-fog">Order pipeline</h2>
      <Panel className="mb-8">
        <div className="flex flex-wrap gap-2 p-4">
          {Object.entries(orders.byStatus).map(([status, count]) => (
            <Link
              key={status}
              to={`/admin/orders?status=${status}`}
              className="rounded border border-stone/40 px-3 py-2 text-sm transition-colors hover:border-pearl"
            >
              <span className="text-fog">{humanise(status)}</span>{' '}
              <span className="font-medium">{count}</span>
            </Link>
          ))}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="🔵 New orders">
          {alerts.newOrders.length === 0 ? (
            <p className="p-4 text-sm text-fog">No orders yet</p>
          ) : (
            <ul className="divide-y divide-stone/25">
              {alerts.newOrders.map((order) => (
                <li key={order.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link
                      to={`/admin/orders/${order.id}`}
                      className="block truncate text-sm hover:underline"
                    >
                      {order.number}
                    </Link>
                    <p className="truncate text-xs text-fog">
                      {customerName(order.user ?? null, order.email)} · {order.itemCount} item(s) ·{' '}
                      {formatRelative(order.createdAt)}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    <span className="text-sm">{formatPrice(order.total, order.currency)}</span>
                    <Badge tone={statusTone(order.status)}>{humanise(order.status)}</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="🟣 New customers">
          {alerts.newCustomers.length === 0 ? (
            <p className="p-4 text-sm text-fog">No customers yet</p>
          ) : (
            <ul className="divide-y divide-stone/25">
              {alerts.newCustomers.map((customer) => (
                <li key={customer.id} className="flex items-center justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <Link
                      to={`/admin/customers/${customer.id}`}
                      className="block truncate text-sm hover:underline"
                    >
                      {customerName(customer, customer.email)}
                    </Link>
                    <p className="truncate text-xs text-fog">
                      {customer.email} · registered {formatRelative(customer.createdAt)}
                    </p>
                  </div>
                  <Badge tone={customer.orderCount > 0 ? 'good' : 'neutral'}>
                    {customer.orderCount} order{customer.orderCount === 1 ? '' : 's'}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

function AlertList({
  title,
  plans,
  tone,
  empty,
}: {
  title: string;
  plans: DashboardAlertPlan[];
  tone: 'bad' | 'warn' | 'good';
  empty: string;
}) {
  return (
    <Panel title={title}>
      {plans.length === 0 ? (
        <p className="p-4 text-sm text-fog">{empty}</p>
      ) : (
        <ul className="divide-y divide-stone/25">
          {plans.map((plan) => (
            <li key={plan.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  to={`/admin/orders/${plan.orderId}`}
                  className="text-sm hover:underline"
                >
                  {plan.orderNumber}
                </Link>
                <Badge tone={tone}>
                  {deadlineLabel(plan.daysRemaining, plan.isOverdue)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-fog">
                {plan.product} × {plan.quantity} · {plan.customer}
                {plan.currentStage ? ` · ${plan.currentStage}` : ''}
                {plan.deadlineAt ? ` · due ${formatDateOnly(plan.deadlineAt)}` : ''}
              </p>
              <div className="mt-2">
                <ProgressBar value={plan.progress} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useEffect } from 'react';
import { Helmet } from 'react-helmet-async';
import { AlertTriangle, Download } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import { useAdminList } from '../hooks';
import type { AdminOrderRow } from '../../types/admin';
import {
  Badge,
  Button,
  EmptyRow,
  ErrorNote,
  Loading,
  PageHeader,
  Pagination,
  Panel,
  ProgressBar,
  SearchInput,
  Select,
  Table,
  TableScroll,
  Td,
  Th,
  humanise,
  statusTone,
} from '../components/ui';
import { customerName, formatDateOnly, formatPrice, formatRelative } from '../format';

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

export default function Orders() {
  const [searchParams] = useSearchParams();
  const initialStatus = searchParams.get('status') ?? 'all';

  const { query, setQuery, data, loading, error, refresh } = useAdminList<AdminOrderRow>(
    (params) => adminApi.orders(params),
    {
      pageSize: 20,
      status: initialStatus,
      paymentStatus: 'all',
      productionStatus: 'all',
      priority: 'all',
      overdue: 'all',
    },
  );

  // Let a dashboard link like ?status=PENDING drive the initial filter.
  useEffect(() => {
    const status = searchParams.get('status');
    if (status && status !== query.status) setQuery({ status });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  return (
    <>
      <Helmet>
        <title>Orders — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <PageHeader
        title="Orders"
        subtitle="Every order placed on the storefront, with its production state."
        actions={
          <a href={adminApi.exportUrl('orders')}>
            <Button variant="secondary">
              <Download size={14} /> Export CSV
            </Button>
          </a>
        }
      />

      <Panel>
        <div className="grid gap-3 border-b border-stone/40 p-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <SearchInput
            value={query.q}
            onChange={(q) => setQuery({ q })}
            placeholder="Order no. or customer"
          />
          <Select
            value={String(query.status)}
            onChange={(e) => setQuery({ status: e.target.value })}
          >
            <option value="all">All order statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanise(s)}
              </option>
            ))}
          </Select>
          <Select
            value={String(query.paymentStatus)}
            onChange={(e) => setQuery({ paymentStatus: e.target.value })}
          >
            <option value="all">All payment statuses</option>
            {PAYMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {humanise(s)}
              </option>
            ))}
          </Select>
          <Select
            value={String(query.productionStatus)}
            onChange={(e) => setQuery({ productionStatus: e.target.value })}
          >
            <option value="all">All production states</option>
            <option value="NOT_STARTED">Not started</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="ON_HOLD">On hold</option>
            <option value="COMPLETED">Completed</option>
          </Select>
          <Select
            value={String(query.priority)}
            onChange={(e) => setQuery({ priority: e.target.value })}
          >
            <option value="all">Any priority</option>
            <option value="URGENT">Urgent</option>
            <option value="HIGH">High</option>
            <option value="NORMAL">Normal</option>
            <option value="LOW">Low</option>
          </Select>
          <Select
            value={String(query.overdue)}
            onChange={(e) => setQuery({ overdue: e.target.value })}
          >
            <option value="all">Overdue: any</option>
            <option value="yes">Overdue only</option>
          </Select>
        </div>

        {error && (
          <div className="p-4">
            <ErrorNote message={error} onRetry={refresh} />
          </div>
        )}

        {loading && !data ? (
          <Loading />
        ) : (
          <TableScroll>
            <Table>
              <thead>
                <tr>
                  <Th>Order</Th>
                  <Th>Customer</Th>
                  <Th>Items</Th>
                  <Th onClick={() => setQuery({ sort: 'total', dir: query.dir === 'asc' ? 'desc' : 'asc' })}>
                    Total
                  </Th>
                  <Th>Payment</Th>
                  <Th>Order status</Th>
                  <Th>Production</Th>
                  <Th onClick={() => setQuery({ sort: 'createdAt', dir: query.dir === 'asc' ? 'desc' : 'asc' })}>
                    Placed
                  </Th>
                  <Th>Required by</Th>
                  <Th>Priority</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).length === 0 ? (
                  <EmptyRow colSpan={10}>No orders match those filters</EmptyRow>
                ) : (
                  data!.items.map((order) => (
                    <tr key={order.id} className="hover:bg-stone/10">
                      <Td>
                        <Link
                          to={`/admin/orders/${order.id}`}
                          className="block whitespace-nowrap hover:underline"
                        >
                          {order.number}
                        </Link>
                        {order.isOverdue && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[0.7rem] font-medium uppercase text-red-300">
                            <AlertTriangle size={11} /> Overdue
                          </span>
                        )}
                      </Td>
                      <Td>
                        {order.user ? (
                          <Link
                            to={`/admin/customers/${order.user.id}`}
                            className="block hover:underline"
                          >
                            {customerName(order.user, order.email)}
                          </Link>
                        ) : (
                          <span>Guest</span>
                        )}
                        <p className="text-xs text-fog">{order.email}</p>
                      </Td>
                      <Td>{order.itemCount}</Td>
                      <Td className="whitespace-nowrap">
                        {formatPrice(order.total, order.currency)}
                      </Td>
                      <Td>
                        {order.payment ? (
                          <Badge tone={statusTone(order.payment.status)}>
                            {humanise(order.payment.status)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-fog">—</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={statusTone(order.status)}>{humanise(order.status)}</Badge>
                      </Td>
                      <Td>
                        {order.productionStatus === 'NONE' ? (
                          <span className="text-xs text-fog">—</span>
                        ) : (
                          <>
                            <Badge tone={statusTone(order.productionStatus)}>
                              {humanise(order.productionStatus)}
                            </Badge>
                            <div className="mt-1">
                              <ProgressBar value={order.productionProgress} />
                            </div>
                          </>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {formatRelative(order.createdAt)}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {order.requiredBy ? (
                          <span className={order.isOverdue ? 'text-red-300' : order.isDueSoon ? 'text-amber-300' : ''}>
                            {formatDateOnly(order.requiredBy)}
                          </span>
                        ) : (
                          <span className="text-fog">—</span>
                        )}
                      </Td>
                      <Td>
                        <Badge
                          tone={
                            order.priority === 'URGENT'
                              ? 'bad'
                              : order.priority === 'HIGH'
                                ? 'warn'
                                : 'neutral'
                          }
                        >
                          {humanise(order.priority)}
                        </Badge>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </Table>
          </TableScroll>
        )}

        {data && (
          <Pagination
            page={data.page}
            pageCount={data.pageCount}
            total={data.total}
            pageSize={data.pageSize}
            onPage={(page) => setQuery({ page })}
          />
        )}
      </Panel>
    </>
  );
}

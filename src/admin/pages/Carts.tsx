import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { RefreshCw } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import { useAdminList } from '../hooks';
import type { AdminCart, Paged } from '../../types/admin';
import {
  Badge,
  Button,
  EmptyRow,
  ErrorNote,
  Loading,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Select,
  Table,
  TableScroll,
  Td,
  Th,
  humanise,
  statusTone,
} from '../components/ui';
import { customerName, formatDateTime, formatPrice, formatRelative } from '../format';

/**
 * Cart activity revalidates every 30 seconds. The stack has no websocket layer,
 * so this is polling — not a live push feed, and not presented as one.
 */
const REFRESH_MS = 30_000;

export default function Carts() {
  const { query, setQuery, data, loading, error, refresh } = useAdminList<
    AdminCart,
    Paged<AdminCart> & { abandonedAfterMinutes: number }
  >(
    (params) => adminApi.carts(params),
    { pageSize: 20, status: 'all' },
    { refreshMs: REFRESH_MS },
  );

  return (
    <>
      <Helmet>
        <title>Live carts — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <PageHeader
        title="Cart activity"
        subtitle="Persisted carts of signed-in customers. Refreshes every 30 seconds."
        actions={
          <Button variant="secondary" onClick={refresh}>
            <RefreshCw size={14} /> Refresh
          </Button>
        }
      />

      <Panel>
        <div className="grid gap-3 border-b border-stone/40 p-4 sm:grid-cols-3">
          <SearchInput
            value={query.q}
            onChange={(q) => setQuery({ q })}
            placeholder="Customer name or email"
          />
          <Select
            value={String(query.status)}
            onChange={(e) => setQuery({ status: e.target.value })}
          >
            <option value="all">All carts with items</option>
            <option value="active">Active</option>
            <option value="abandoned">Abandoned</option>
            <option value="converted">Converted</option>
          </Select>
          <p className="self-center text-xs text-fog">
            Carts idle longer than {data ? Math.round(data.abandonedAfterMinutes / 60) : '—'}h read
            as abandoned.
          </p>
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
                  <Th>Customer</Th>
                  <Th>Cart contents</Th>
                  <Th>Items</Th>
                  <Th>Cart value</Th>
                  <Th>Created</Th>
                  <Th>Last activity</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).length === 0 ? (
                  <EmptyRow colSpan={7}>No carts match those filters</EmptyRow>
                ) : (
                  data!.items.map((cart) => (
                    <tr key={cart.id} className="hover:bg-stone/10">
                      <Td>
                        <Link
                          to={`/admin/customers/${cart.customer.id}`}
                          className="block hover:underline"
                        >
                          {customerName(cart.customer, cart.customer.email)}
                        </Link>
                        <p className="text-xs text-fog">{cart.customer.email}</p>
                      </Td>
                      <Td>
                        {cart.items.length === 0 ? (
                          <span className="text-xs text-fog">Emptied at checkout</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {cart.items.map((item) => (
                              <li key={item.id} className="text-sm">
                                {item.product.name}{' '}
                                <span className="text-fog">
                                  ({item.size}) × {item.quantity} ·{' '}
                                  {formatPrice(item.product.price)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </Td>
                      <Td>{cart.itemCount}</Td>
                      <Td className="whitespace-nowrap font-medium">{formatPrice(cart.value)}</Td>
                      <Td className="whitespace-nowrap text-xs text-fog">
                        {formatDateTime(cart.createdAt)}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {formatRelative(cart.updatedAt)}
                      </Td>
                      <Td>
                        <Badge tone={statusTone(cart.status)}>{humanise(cart.status)}</Badge>
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

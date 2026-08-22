import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Download } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import { useAdminList } from '../hooks';
import type { AdminCustomerRow } from '../../types/admin';
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
} from '../components/ui';
import { customerName, formatDateOnly, formatPrice, formatRelative } from '../format';

export default function Customers() {
  const { query, setQuery, data, loading, error, refresh } = useAdminList<AdminCustomerRow>(
    (params) => adminApi.customers(params),
    { pageSize: 20, status: 'all', hasCart: 'all', hasOrders: 'all' },
  );

  return (
    <>
      <Helmet>
        <title>Customers — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <PageHeader
        title="Customers"
        subtitle="Everyone who has registered an account on the storefront."
        actions={
          <a href={adminApi.exportUrl('customers')}>
            <Button variant="secondary">
              <Download size={14} /> Export CSV
            </Button>
          </a>
        }
      />

      <Panel>
        <div className="grid gap-3 border-b border-stone/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput
            value={query.q}
            onChange={(q) => setQuery({ q })}
            placeholder="Name, email or phone"
          />
          <Select
            value={String(query.status)}
            onChange={(e) => setQuery({ status: e.target.value })}
          >
            <option value="all">All accounts</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
          </Select>
          <Select
            value={String(query.hasCart)}
            onChange={(e) => setQuery({ hasCart: e.target.value })}
          >
            <option value="all">Any cart</option>
            <option value="yes">Has items in cart</option>
          </Select>
          <Select
            value={String(query.hasOrders)}
            onChange={(e) => setQuery({ hasOrders: e.target.value })}
          >
            <option value="all">Any order history</option>
            <option value="yes">Has ordered</option>
            <option value="no">Never ordered</option>
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
                  <Th>Customer</Th>
                  <Th>Phone</Th>
                  <Th onClick={() => setQuery({ sort: 'createdAt', dir: query.dir === 'asc' ? 'desc' : 'asc' })}>
                    Registered
                  </Th>
                  <Th>Last login</Th>
                  <Th>Orders</Th>
                  <Th>Total spent</Th>
                  <Th>Current cart</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).length === 0 ? (
                  <EmptyRow colSpan={8}>No customers match those filters</EmptyRow>
                ) : (
                  data!.items.map((customer) => (
                    <tr key={customer.id} className="hover:bg-stone/10">
                      <Td>
                        <Link
                          to={`/admin/customers/${customer.id}`}
                          className="block hover:underline"
                        >
                          {customerName(customer, customer.email)}
                        </Link>
                        <p className="text-xs text-fog">{customer.email}</p>
                      </Td>
                      <Td className="text-sm text-mist">{customer.phone ?? '—'}</Td>
                      <Td className="whitespace-nowrap text-sm">
                        {formatDateOnly(customer.createdAt)}
                        <p className="text-xs text-fog">{formatRelative(customer.createdAt)}</p>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-fog">
                        {customer.lastLoginAt ? formatRelative(customer.lastLoginAt) : 'Never'}
                      </Td>
                      <Td>{customer.orderCount}</Td>
                      <Td className="whitespace-nowrap">{formatPrice(customer.totalSpent)}</Td>
                      <Td>
                        {customer.cartItemCount > 0 ? (
                          <>
                            <Badge tone="info">{customer.cartItemCount} item(s)</Badge>
                            <p className="mt-0.5 text-xs text-fog">
                              {formatPrice(customer.cartValue)}
                            </p>
                          </>
                        ) : (
                          <span className="text-xs text-fog">Empty</span>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={customer.isActive ? 'good' : 'bad'}>
                          {customer.isActive ? 'Active' : 'Suspended'}
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

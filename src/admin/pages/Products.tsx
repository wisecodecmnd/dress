import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { Download, ExternalLink, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import { useAdminList } from '../hooks';
import type { AdminCategory, AdminProduct } from '../../types/admin';
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
import { formatPrice } from '../format';

export default function Products() {
  const { query, setQuery, data, loading, error, refresh } = useAdminList<AdminProduct>(
    (params) => adminApi.products(params),
    { pageSize: 20, status: 'all', stock: 'all', featured: 'all' },
  );

  const [categories, setCategories] = useState<AdminCategory[]>([]);

  useEffect(() => {
    // Populate the category filter. Small, bounded list.
    adminApi
      .categories({ pageSize: 100, sort: 'position', dir: 'asc' })
      .then((res) => setCategories(res.items))
      .catch(() => setCategories([]));
  }, []);

  const remove = async (product: AdminProduct) => {
    const message =
      (product.orderCount ?? 0) > 0
        ? `"${product.name}" appears in ${product.orderCount} order line(s), so it will be archived rather than deleted. Continue?`
        : `Delete "${product.name}" permanently?`;
    if (!window.confirm(message)) return;

    await adminApi.deleteProduct(product.id);
    refresh();
  };

  const restore = async (product: AdminProduct) => {
    await adminApi.restoreProduct(product.id);
    refresh();
  };

  const toggleActive = async (product: AdminProduct) => {
    await adminApi.updateProduct(product.id, { isActive: !product.isActive });
    refresh();
  };

  const toggleFeatured = async (product: AdminProduct) => {
    await adminApi.updateProduct(product.id, { isFeatured: !product.isFeatured });
    refresh();
  };

  return (
    <>
      <Helmet>
        <title>Products — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <PageHeader
        title="Products"
        subtitle="Price, availability and category changes appear on the storefront on its next fetch."
        actions={
          <>
            <a href={adminApi.exportUrl('products')}>
              <Button variant="secondary">
                <Download size={14} /> Export CSV
              </Button>
            </a>
            <Link to="/admin/products/new">
              <Button variant="primary">
                <Plus size={15} /> New product
              </Button>
            </Link>
          </>
        }
      />

      <Panel>
        <div className="grid gap-3 border-b border-stone/40 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <SearchInput
            value={query.q}
            onChange={(q) => setQuery({ q })}
            placeholder="Name, slug or SKU"
          />
          <Select
            value={String(query.categoryId ?? '')}
            onChange={(e) => setQuery({ categoryId: e.target.value })}
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Select
            value={String(query.status)}
            onChange={(e) => setQuery({ status: e.target.value })}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Disabled</option>
            <option value="archived">Archived</option>
          </Select>
          <Select value={String(query.stock)} onChange={(e) => setQuery({ stock: e.target.value })}>
            <option value="all">Any stock</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </Select>
          <Select
            value={String(query.featured)}
            onChange={(e) => setQuery({ featured: e.target.value })}
          >
            <option value="all">Featured: any</option>
            <option value="yes">Featured only</option>
            <option value="no">Not featured</option>
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
                  <Th>Product</Th>
                  <Th>Category</Th>
                  <Th onClick={() => setQuery({ sort: 'price', dir: query.dir === 'asc' ? 'desc' : 'asc' })}>
                    Price
                  </Th>
                  <Th>Stock</Th>
                  <Th>Processes</Th>
                  <Th>Status</Th>
                  <Th>Featured</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).length === 0 ? (
                  <EmptyRow colSpan={8}>No products match those filters</EmptyRow>
                ) : (
                  data!.items.map((product) => (
                    <tr key={product.id} className="hover:bg-stone/10">
                      <Td>
                        <div className="flex items-center gap-3">
                          {product.images?.[0]?.url ? (
                            <img
                              src={product.images[0].url}
                              alt=""
                              className="h-10 w-10 flex-shrink-0 rounded object-cover"
                            />
                          ) : (
                            <div className="h-10 w-10 flex-shrink-0 rounded bg-stone/30" />
                          )}
                          <div className="min-w-0">
                            <Link
                              to={`/admin/products/${product.id}`}
                              className="block truncate hover:underline"
                            >
                              {product.name}
                            </Link>
                            <p className="truncate text-xs text-fog">
                              {product.sku ? `${product.sku} · ` : ''}
                              <a
                                href={`/product/${product.slug}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 hover:text-denim"
                              >
                                /{product.slug} <ExternalLink size={10} />
                              </a>
                            </p>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-sm text-mist">{product.category?.name ?? '—'}</Td>
                      <Td className="whitespace-nowrap">
                        {formatPrice(product.price, product.currency)}
                        {product.comparePrice && (
                          <span className="ml-1 text-xs text-fog line-through">
                            {formatPrice(product.comparePrice, product.currency)}
                          </span>
                        )}
                      </Td>
                      <Td>
                        {product.stock === null || product.stock === undefined ? (
                          <span className="text-xs text-fog">Unlimited</span>
                        ) : (
                          <Badge
                            tone={
                              product.stock === 0 ? 'bad' : product.stock <= 5 ? 'warn' : 'good'
                            }
                          >
                            {product.stock}
                          </Badge>
                        )}
                      </Td>
                      <Td>
                        <Badge tone={(product.processCount ?? 0) > 0 ? 'info' : 'warn'}>
                          {product.processCount ?? 0} stage
                          {(product.processCount ?? 0) === 1 ? '' : 's'}
                        </Badge>
                      </Td>
                      <Td>
                        {product.archivedAt ? (
                          <Badge tone="warn">Archived</Badge>
                        ) : (
                          <button onClick={() => toggleActive(product)} title="Click to toggle">
                            <Badge tone={product.isActive ? 'good' : 'neutral'}>
                              {product.isActive ? 'Active' : 'Disabled'}
                            </Badge>
                          </button>
                        )}
                      </Td>
                      <Td>
                        <button onClick={() => toggleFeatured(product)} title="Click to toggle">
                          <Badge tone={product.isFeatured ? 'accent' : 'neutral'}>
                            {product.isFeatured ? 'Yes' : 'No'}
                          </Badge>
                        </button>
                      </Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Link to={`/admin/products/${product.id}`}>
                            <Button variant="ghost">Edit</Button>
                          </Link>
                          {product.archivedAt ? (
                            <Button
                              variant="ghost"
                              onClick={() => restore(product)}
                              aria-label="Restore"
                            >
                              <RotateCcw size={14} />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              onClick={() => remove(product)}
                              aria-label="Delete"
                            >
                              <Trash2 size={14} />
                            </Button>
                          )}
                        </div>
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

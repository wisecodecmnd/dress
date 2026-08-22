import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ArrowDown, ArrowUp, ExternalLink, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import { useAdminList } from '../hooks';
import type { AdminCategory } from '../../types/admin';
import {
  Badge,
  Button,
  EmptyRow,
  ErrorNote,
  Field,
  Input,
  Loading,
  Modal,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Select,
  Table,
  TableScroll,
  Td,
  Textarea,
  Th,
  Toggle,
} from '../components/ui';
import { formatDateOnly } from '../format';

const blank = {
  name: '',
  slug: '',
  description: '',
  image: '',
  position: 0,
  isActive: true,
  isFeatured: false,
};

type Draft = typeof blank;

/** Mirrors the server's slugify so the preview URL matches what gets saved. */
const slugify = (input: string) =>
  input
    .toLowerCase()
    .trim()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

export default function Categories() {
  const { query, setQuery, data, loading, error, refresh } = useAdminList<AdminCategory>(
    (params) => adminApi.categories(params),
    { pageSize: 20, status: 'all', featured: 'all', sort: 'position', dir: 'asc' },
  );

  const [editing, setEditing] = useState<AdminCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openCreate = () => {
    setDraft(blank);
    setSaveError(null);
    setCreating(true);
  };

  const openEdit = (category: AdminCategory) => {
    setDraft({
      name: category.name,
      slug: category.slug,
      description: category.description ?? '',
      image: category.image ?? '',
      position: category.position,
      isActive: category.isActive,
      isFeatured: category.isFeatured,
    });
    setSaveError(null);
    setEditing(category);
  };

  const close = () => {
    setCreating(false);
    setEditing(null);
  };

  const save = async () => {
    setBusy(true);
    setSaveError(null);

    // Empty optional strings become null rather than failing URL validation.
    const body = {
      name: draft.name,
      slug: draft.slug || slugify(draft.name),
      description: draft.description || null,
      image: draft.image || null,
      position: draft.position,
      isActive: draft.isActive,
      isFeatured: draft.isFeatured,
    };

    try {
      if (editing) await adminApi.updateCategory(editing.id, body);
      else await adminApi.createCategory(body);
      close();
      refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (category: AdminCategory) => {
    await adminApi.updateCategory(category.id, { isActive: !category.isActive });
    refresh();
  };

  const toggleFeatured = async (category: AdminCategory) => {
    await adminApi.updateCategory(category.id, { isFeatured: !category.isFeatured });
    refresh();
  };

  const move = async (category: AdminCategory, direction: -1 | 1) => {
    const items = data?.items ?? [];
    const index = items.findIndex((c) => c.id === category.id);
    const swapWith = items[index + direction];
    if (!swapWith) return;

    await adminApi.reorderCategories([
      { id: category.id, position: swapWith.position },
      { id: swapWith.id, position: category.position },
    ]);
    refresh();
  };

  const remove = async (category: AdminCategory) => {
    const message =
      (category.productCount ?? 0) > 0
        ? `"${category.name}" has ${category.productCount} product(s), so it will be archived and hidden rather than deleted. Continue?`
        : `Delete "${category.name}" permanently?`;
    if (!window.confirm(message)) return;

    await adminApi.deleteCategory(category.id);
    refresh();
  };

  const restore = async (category: AdminCategory) => {
    await adminApi.restoreCategory(category.id);
    refresh();
  };

  return (
    <>
      <Helmet>
        <title>Categories — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <PageHeader
        title="Categories"
        subtitle="A category's slug is its storefront URL. Creating one makes /shop/<slug> work immediately."
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus size={15} /> New category
          </Button>
        }
      />

      <Panel>
        <div className="grid gap-3 border-b border-stone/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput
            value={query.q}
            onChange={(q) => setQuery({ q })}
            placeholder="Search name or slug"
          />
          <Select
            value={String(query.status)}
            onChange={(e) => setQuery({ status: e.target.value })}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Disabled</option>
            <option value="archived">Archived</option>
          </Select>
          <Select
            value={String(query.featured)}
            onChange={(e) => setQuery({ featured: e.target.value })}
          >
            <option value="all">Featured: any</option>
            <option value="yes">Featured only</option>
            <option value="no">Not featured</option>
          </Select>
          <Select
            value={`${query.sort}:${query.dir}`}
            onChange={(e) => {
              const [sort, dir] = e.target.value.split(':');
              setQuery({ sort, dir });
            }}
          >
            <option value="position:asc">Order</option>
            <option value="name:asc">Name A–Z</option>
            <option value="createdAt:desc">Newest</option>
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
                  <Th>Name</Th>
                  <Th>Storefront URL</Th>
                  <Th>Products</Th>
                  <Th>Status</Th>
                  <Th>Featured</Th>
                  <Th>Order</Th>
                  <Th>Created</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).length === 0 ? (
                  <EmptyRow colSpan={8}>No categories match those filters</EmptyRow>
                ) : (
                  data!.items.map((category, index) => (
                    <tr key={category.id} className="hover:bg-stone/10">
                      <Td>
                        <button
                          onClick={() => openEdit(category)}
                          className="text-left hover:underline"
                        >
                          {category.name}
                        </button>
                        {category.description && (
                          <p className="mt-0.5 max-w-xs truncate text-xs text-fog">
                            {category.description}
                          </p>
                        )}
                      </Td>
                      <Td>
                        <a
                          href={`/shop/${category.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-denim hover:underline"
                        >
                          /shop/{category.slug} <ExternalLink size={11} />
                        </a>
                      </Td>
                      <Td>{category.productCount ?? 0}</Td>
                      <Td>
                        {category.archivedAt ? (
                          <Badge tone="warn">Archived</Badge>
                        ) : (
                          <button onClick={() => toggleActive(category)} title="Click to toggle">
                            <Badge tone={category.isActive ? 'good' : 'neutral'}>
                              {category.isActive ? 'Active' : 'Disabled'}
                            </Badge>
                          </button>
                        )}
                      </Td>
                      <Td>
                        <button onClick={() => toggleFeatured(category)} title="Click to toggle">
                          <Badge tone={category.isFeatured ? 'accent' : 'neutral'}>
                            {category.isFeatured ? 'Featured' : 'No'}
                          </Badge>
                        </button>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-fog">{category.position}</span>
                          <button
                            onClick={() => move(category, -1)}
                            disabled={index === 0}
                            aria-label="Move up"
                            className="rounded p-1 text-fog hover:text-pearl disabled:opacity-30"
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            onClick={() => move(category, 1)}
                            disabled={index === (data?.items.length ?? 0) - 1}
                            aria-label="Move down"
                            className="rounded p-1 text-fog hover:text-pearl disabled:opacity-30"
                          >
                            <ArrowDown size={12} />
                          </button>
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-fog">
                        {formatDateOnly(category.createdAt)}
                      </Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" onClick={() => openEdit(category)}>
                            Edit
                          </Button>
                          {category.archivedAt ? (
                            <Button
                              variant="ghost"
                              onClick={() => restore(category)}
                              aria-label="Restore"
                            >
                              <RotateCcw size={14} />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              onClick={() => remove(category)}
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

      <Modal
        open={creating || Boolean(editing)}
        onClose={close}
        title={editing ? `Edit ${editing.name}` : 'New category'}
      >
        <div className="space-y-4">
          {saveError && <ErrorNote message={saveError} />}

          <Field label="Name">
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              autoFocus
            />
          </Field>

          <Field
            label="Slug"
            hint={`Storefront URL: /shop/${draft.slug || slugify(draft.name) || '…'}`}
          >
            <Input
              value={draft.slug}
              onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              placeholder={slugify(draft.name)}
            />
          </Field>

          <Field label="Description">
            <Textarea
              rows={3}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </Field>

          <Field label="Image URL" hint="Optional">
            <Input
              value={draft.image}
              onChange={(e) => setDraft({ ...draft, image: e.target.value })}
              placeholder="https://…"
            />
          </Field>

          <Field label="Display order">
            <Input
              type="number"
              min={0}
              value={draft.position}
              onChange={(e) => setDraft({ ...draft, position: Number(e.target.value) })}
            />
          </Field>

          <div className="flex flex-wrap gap-4">
            <Toggle
              checked={draft.isActive}
              onChange={(isActive) => setDraft({ ...draft, isActive })}
              label="Visible on storefront"
            />
            <Toggle
              checked={draft.isFeatured}
              onChange={(isFeatured) => setDraft({ ...draft, isFeatured })}
              label="Featured"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={busy || draft.name.trim().length < 2}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create category'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import { useAdminList } from '../hooks';
import type { AdminProcessStage } from '../../types/admin';
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
import { formatDuration, formatPrice } from '../format';

const blank = {
  name: '',
  slug: '',
  description: '',
  /** Collected in hours because that is how the workshop thinks. */
  hours: '1',
  defaultCost: '0',
  isActive: true,
};

type Draft = typeof blank;

export default function Processes() {
  const { query, setQuery, data, loading, error, refresh } = useAdminList<AdminProcessStage>(
    (params) => adminApi.processes(params),
    { pageSize: 50, status: 'all' },
  );

  const [editing, setEditing] = useState<AdminProcessStage | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openCreate = () => {
    setDraft(blank);
    setSaveError(null);
    setCreating(true);
  };

  const openEdit = (stage: AdminProcessStage) => {
    setDraft({
      name: stage.name,
      slug: stage.slug,
      description: stage.description ?? '',
      hours: String(stage.defaultDuration / 60),
      defaultCost: String(stage.defaultCost),
      isActive: stage.isActive,
    });
    setSaveError(null);
    setEditing(stage);
  };

  const close = () => {
    setCreating(false);
    setEditing(null);
  };

  const save = async () => {
    setBusy(true);
    setSaveError(null);

    const minutes = Math.max(1, Math.round(Number(draft.hours) * 60));

    const body = {
      name: draft.name,
      slug: draft.slug || undefined,
      description: draft.description || null,
      defaultDuration: minutes,
      durationUnit: 'HOURS',
      defaultCost: Number(draft.defaultCost) || 0,
      isActive: draft.isActive,
    };

    try {
      if (editing) await adminApi.updateStage(editing.id, body);
      else await adminApi.createStage(body);
      close();
      refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  const move = async (stage: AdminProcessStage, direction: -1 | 1) => {
    const items = data?.items ?? [];
    const index = items.findIndex((s) => s.id === stage.id);
    const swapWith = items[index + direction];
    if (!swapWith) return;

    await adminApi.reorderStages([
      { id: stage.id, sortOrder: swapWith.sortOrder },
      { id: swapWith.id, sortOrder: stage.sortOrder },
    ]);
    refresh();
  };

  const remove = async (stage: AdminProcessStage) => {
    const message =
      (stage.productCount ?? 0) > 0
        ? `"${stage.name}" is used by ${stage.productCount} product(s), so it will be archived rather than deleted. Continue?`
        : `Delete "${stage.name}" permanently?`;
    if (!window.confirm(message)) return;

    await adminApi.deleteStage(stage.id);
    refresh();
  };

  const toggleActive = async (stage: AdminProcessStage) => {
    await adminApi.updateStage(stage.id, { isActive: !stage.isActive });
    refresh();
  };

  return (
    <>
      <Helmet>
        <title>Process stages — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <PageHeader
        title="Process stages"
        subtitle="The manufacturing steps every product draws on. Durations here are defaults; a product can override them."
        actions={
          <Button variant="primary" onClick={openCreate}>
            <Plus size={15} /> New stage
          </Button>
        }
      />

      <Panel>
        <div className="grid gap-3 border-b border-stone/40 p-4 sm:grid-cols-3">
          <SearchInput value={query.q} onChange={(q) => setQuery({ q })} placeholder="Search name" />
          <Select
            value={String(query.status)}
            onChange={(e) => setQuery({ status: e.target.value })}
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Disabled</option>
            <option value="archived">Archived</option>
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
                  <Th>Stage</Th>
                  <Th>Default duration</Th>
                  <Th>Default cost</Th>
                  <Th>Products using</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).length === 0 ? (
                  <EmptyRow colSpan={7}>No process stages yet</EmptyRow>
                ) : (
                  data!.items.map((stage, index) => (
                    <tr key={stage.id} className="hover:bg-stone/10">
                      <Td>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-fog">{index + 1}</span>
                          <button
                            onClick={() => move(stage, -1)}
                            disabled={index === 0}
                            aria-label="Move up"
                            className="rounded p-1 text-fog hover:text-pearl disabled:opacity-30"
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            onClick={() => move(stage, 1)}
                            disabled={index === (data?.items.length ?? 0) - 1}
                            aria-label="Move down"
                            className="rounded p-1 text-fog hover:text-pearl disabled:opacity-30"
                          >
                            <ArrowDown size={12} />
                          </button>
                        </div>
                      </Td>
                      <Td>
                        <button onClick={() => openEdit(stage)} className="text-left hover:underline">
                          {stage.name}
                        </button>
                        {stage.description && (
                          <p className="mt-0.5 max-w-sm truncate text-xs text-fog">
                            {stage.description}
                          </p>
                        )}
                      </Td>
                      <Td className="whitespace-nowrap">
                        {formatDuration(stage.defaultDuration)}
                        <span className="ml-1 text-xs text-fog">({stage.defaultDuration}m)</span>
                      </Td>
                      <Td>{formatPrice(stage.defaultCost)}</Td>
                      <Td>{stage.productCount ?? 0}</Td>
                      <Td>
                        {stage.archivedAt ? (
                          <Badge tone="warn">Archived</Badge>
                        ) : (
                          <button onClick={() => toggleActive(stage)} title="Click to toggle">
                            <Badge tone={stage.isActive ? 'good' : 'neutral'}>
                              {stage.isActive ? 'Active' : 'Disabled'}
                            </Badge>
                          </button>
                        )}
                      </Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" onClick={() => openEdit(stage)}>
                            Edit
                          </Button>
                          <Button variant="ghost" onClick={() => remove(stage)} aria-label="Delete">
                            <Trash2 size={14} />
                          </Button>
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
        title={editing ? `Edit ${editing.name}` : 'New process stage'}
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

          <Field label="Description">
            <Textarea
              rows={2}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Default duration (hours)"
              hint={`= ${Math.max(1, Math.round(Number(draft.hours) * 60))} minutes`}
            >
              <Input
                type="number"
                min={0.1}
                step="0.5"
                value={draft.hours}
                onChange={(e) => setDraft({ ...draft, hours: e.target.value })}
              />
            </Field>

            <Field label="Default cost">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={draft.defaultCost}
                onChange={(e) => setDraft({ ...draft, defaultCost: e.target.value })}
              />
            </Field>
          </div>

          <Toggle
            checked={draft.isActive}
            onChange={(isActive) => setDraft({ ...draft, isActive })}
            label="Active"
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={close}>Cancel</Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={busy || draft.name.trim().length < 2}
            >
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Create stage'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

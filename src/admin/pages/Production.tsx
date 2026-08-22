import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { AlertTriangle, Download, Play, RefreshCw } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import { useAdminList } from '../hooks';
import type { AdminProductionPlan } from '../../types/admin';
import {
  Badge,
  Button,
  EmptyRow,
  ErrorNote,
  Loading,
  Modal,
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
import { customerName, deadlineLabel, formatDateOnly, formatDuration } from '../format';
import ProductionPlanPanel from '../components/ProductionPlanPanel';

/** The board revalidates every 60s; work moves in minutes, not seconds. */
const REFRESH_MS = 60_000;

export default function Production() {
  const { query, setQuery, data, loading, error, refresh } = useAdminList<AdminProductionPlan>(
    (params) => adminApi.production(params),
    { pageSize: 20, view: 'active', status: 'all' },
    { refreshMs: REFRESH_MS },
  );

  const [open, setOpen] = useState<AdminProductionPlan | null>(null);
  const [busy, setBusy] = useState(false);

  const start = async (plan: AdminProductionPlan) => {
    setBusy(true);
    try {
      await adminApi.startProduction(plan.id);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Production — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <PageHeader
        title="Production"
        subtitle="Every ordered piece and where it is in the workshop. Refreshes every minute."
        actions={
          <>
            <a href={adminApi.exportUrl('production')}>
              <Button variant="secondary">
                <Download size={14} /> Export CSV
              </Button>
            </a>
            <Button variant="secondary" onClick={refresh}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </>
        }
      />

      {/* View tabs — the board's primary navigation */}
      <div className="mb-4 flex flex-wrap gap-2">
        {[
          { value: 'active', label: 'Active' },
          { value: 'overdue', label: 'Overdue' },
          { value: 'dueToday', label: 'Due today' },
          { value: 'dueTomorrow', label: 'Due tomorrow' },
          { value: 'dueSoon', label: 'Due soon' },
          { value: 'completedToday', label: 'Completed today' },
          { value: 'all', label: 'All' },
        ].map((tab) => (
          <button
            key={tab.value}
            onClick={() => setQuery({ view: tab.value })}
            className={`rounded border px-3 py-1.5 text-sm transition-colors ${
              query.view === tab.value
                ? 'border-pearl bg-stone/40 text-pearl'
                : 'border-stone/50 text-mist hover:border-pearl'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Panel>
        <div className="grid gap-3 border-b border-stone/40 p-4 sm:grid-cols-3">
          <SearchInput
            value={query.q}
            onChange={(q) => setQuery({ q })}
            placeholder="Order no., product or email"
          />
          <Select
            value={String(query.status)}
            onChange={(e) => setQuery({ status: e.target.value })}
          >
            <option value="all">All plan statuses</option>
            <option value="NOT_STARTED">Not started</option>
            <option value="IN_PROGRESS">In progress</option>
            <option value="ON_HOLD">On hold</option>
            <option value="COMPLETED">Completed</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
          <SearchInput
            value={String(query.stage ?? '')}
            onChange={(stage) => setQuery({ stage })}
            placeholder="Filter by current stage"
          />
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
                  <Th>Product</Th>
                  <Th>Current stage</Th>
                  <Th>Progress</Th>
                  <Th>Started</Th>
                  <Th>Expected</Th>
                  <Th>Remaining</Th>
                  <Th>Deadline</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {(data?.items ?? []).length === 0 ? (
                  <EmptyRow colSpan={11}>Nothing in this view</EmptyRow>
                ) : (
                  data!.items.map((plan) => (
                    <tr
                      key={plan.id}
                      className={`hover:bg-stone/10 ${plan.isOverdue ? 'bg-red-500/5' : ''}`}
                    >
                      <Td>
                        {plan.order && (
                          <Link
                            to={`/admin/orders/${plan.order.id}`}
                            className="block whitespace-nowrap hover:underline"
                          >
                            {plan.order.number}
                          </Link>
                        )}
                        {plan.isOverdue && (
                          <span className="mt-1 inline-flex items-center gap-1 text-[0.7rem] font-medium uppercase text-red-300">
                            <AlertTriangle size={11} /> Overdue
                          </span>
                        )}
                      </Td>
                      <Td className="text-sm">
                        {customerName(plan.order?.user ?? null, plan.order?.email ?? '')}
                      </Td>
                      <Td className="text-sm">
                        {plan.product?.name}
                        <p className="text-xs text-fog">
                          {plan.orderItem?.size ? `Size ${plan.orderItem.size} · ` : ''}× {plan.quantity}
                        </p>
                      </Td>
                      <Td className="text-sm">{plan.currentStage?.name ?? '—'}</Td>
                      <Td>
                        <ProgressBar value={plan.progress} />
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-fog">
                        {formatDateOnly(plan.actualStartAt)}
                      </Td>
                      <Td className="whitespace-nowrap text-xs text-fog">
                        {formatDateOnly(plan.estimatedCompletionAt)}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        {formatDuration(plan.remainingMinutes ?? 0)}
                      </Td>
                      <Td className="whitespace-nowrap text-xs">
                        <span
                          className={
                            plan.isOverdue
                              ? 'text-red-300'
                              : plan.isDueSoon
                                ? 'text-amber-300'
                                : ''
                          }
                        >
                          {formatDateOnly(plan.deadlineAt)}
                        </span>
                        <p className="text-fog">
                          {deadlineLabel(plan.daysRemaining, plan.isOverdue)}
                        </p>
                      </Td>
                      <Td>
                        <Badge tone={statusTone(plan.status)}>{humanise(plan.status)}</Badge>
                      </Td>
                      <Td className="text-right">
                        <div className="flex justify-end gap-1">
                          {plan.status === 'NOT_STARTED' && (
                            <Button variant="ghost" disabled={busy} onClick={() => start(plan)}>
                              <Play size={13} /> Start
                            </Button>
                          )}
                          <Button variant="ghost" onClick={() => setOpen(plan)}>
                            Manage
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
        open={Boolean(open)}
        onClose={() => setOpen(null)}
        title={open?.order ? `Order ${open.order.number}` : 'Production plan'}
        wide
      >
        {open && (
          <ProductionPlanPanel
            plan={open}
            title={`${open.product?.name ?? 'Item'} × ${open.quantity}`}
            onChanged={() => {
              refresh();
              // Pull the fresh plan back into the open modal.
              void adminApi
                .plan(open.id)
                .then((res) => setOpen(res.plan))
                .catch(() => setOpen(null));
            }}
          />
        )}
      </Modal>
    </>
  );
}

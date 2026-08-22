import { useState } from 'react';
import { Check, CircleDot, Circle, Play, RefreshCw, Ban } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import type { AdminProductionPlan, StageStatus } from '../../types/admin';
import {
  Badge,
  Button,
  ErrorNote,
  Field,
  Input,
  Panel,
  ProgressBar,
  Select,
  humanise,
  statusTone,
} from './ui';
import { deadlineLabel, formatDateOnly, formatDateTime, formatDuration, formatPrice, toDateInput } from '../format';

/**
 * One ordered line's production plan: its stages, its progress, its deadline.
 *
 * Completing a stage is a single click — the server records the completion
 * time, derives the actual duration, and opens the next stage.
 */
const STAGE_ICON: Record<StageStatus, typeof Check> = {
  COMPLETED: Check,
  IN_PROGRESS: CircleDot,
  PENDING: Circle,
  BLOCKED: Ban,
  SKIPPED: Circle,
};

export default function ProductionPlanPanel({
  plan,
  title,
  onChanged,
}: {
  plan: AdminProductionPlan;
  title: string;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  const canStart = plan.status === 'NOT_STARTED';

  return (
    <Panel
      title={title}
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(plan.status)}>{humanise(plan.status)}</Badge>
          {plan.isOverdue && <Badge tone="bad">Overdue</Badge>}
          {!plan.isOverdue && plan.isDueSoon && <Badge tone="warn">Due soon</Badge>}
        </div>
      }
    >
      <div className="space-y-4 p-4">
        {error && <ErrorNote message={error} />}

        <div className="grid gap-3 sm:grid-cols-3">
          <Metric label="Progress">
            <ProgressBar value={plan.progress} />
          </Metric>
          <Metric label="Current stage">
            <span className="text-sm">{plan.currentStage?.name ?? '—'}</span>
          </Metric>
          <Metric label="Deadline">
            <span
              className={`text-sm ${
                plan.isOverdue ? 'text-red-300' : plan.isDueSoon ? 'text-amber-300' : ''
              }`}
            >
              {deadlineLabel(plan.daysRemaining, plan.isOverdue)}
            </span>
          </Metric>
        </div>

        <div className="grid gap-3 text-xs text-fog sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <p className="uppercase tracking-wide">Estimated</p>
            <p className="text-mist">{formatDuration(plan.estimatedMinutes)}</p>
          </div>
          <div>
            <p className="uppercase tracking-wide">Process cost</p>
            <p className="text-mist">{formatPrice(plan.estimatedCost)}</p>
          </div>
          <div>
            <p className="uppercase tracking-wide">Est. completion</p>
            <p className="text-mist">{formatDateOnly(plan.estimatedCompletionAt)}</p>
          </div>
          <div>
            <p className="uppercase tracking-wide">Remaining work</p>
            <p className="text-mist">{formatDuration(plan.remainingMinutes ?? 0)}</p>
          </div>
          <div>
            <p className="uppercase tracking-wide">Actual start</p>
            <p className="text-mist">{formatDateTime(plan.actualStartAt)}</p>
          </div>
          <div>
            <p className="uppercase tracking-wide">Actual completion</p>
            <p className="text-mist">{formatDateTime(plan.actualCompletionAt)}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3 border-y border-stone/40 py-3">
          {canStart && (
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => run(() => adminApi.startProduction(plan.id))}
            >
              <Play size={14} /> Start production
            </Button>
          )}

          <Field label="Deadline" className="w-44">
            <Input
              type="date"
              defaultValue={toDateInput(plan.deadlineAt)}
              disabled={busy}
              onChange={(e) =>
                run(() =>
                  adminApi.updatePlan(plan.id, {
                    deadlineAt: e.target.value ? new Date(e.target.value).toISOString() : null,
                  }),
                )
              }
            />
          </Field>

          <Field label="Plan status" className="w-44">
            <Select
              value={plan.status}
              disabled={busy}
              onChange={(e) => run(() => adminApi.updatePlan(plan.id, { status: e.target.value }))}
            >
              {['NOT_STARTED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'].map((s) => (
                <option key={s} value={s}>
                  {humanise(s)}
                </option>
              ))}
            </Select>
          </Field>

          {plan.stages.length === 0 && (
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => run(() => adminApi.rebuildPlan(plan.id))}
              title="Recreate the stage list from the product's current process configuration"
            >
              <RefreshCw size={14} /> Rebuild from product
            </Button>
          )}
        </div>

        {plan.stages.length === 0 ? (
          <p className="text-sm text-fog">
            This plan has no stages — the product had no process configuration when the order was
            placed. Configure the product's processes, then rebuild.
          </p>
        ) : (
          <ol className="space-y-2">
            {plan.stages.map((stage) => {
              const Icon = STAGE_ICON[stage.status];
              const done = stage.status === 'COMPLETED';

              return (
                <li
                  key={stage.id}
                  className={`rounded border p-3 ${
                    stage.status === 'IN_PROGRESS'
                      ? 'border-denim/60 bg-denim/10'
                      : 'border-stone/40'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon
                        size={15}
                        className={
                          done
                            ? 'text-emerald-400'
                            : stage.status === 'IN_PROGRESS'
                              ? 'text-denim'
                              : stage.status === 'BLOCKED'
                                ? 'text-red-300'
                                : 'text-fog'
                        }
                      />
                      <span className={`text-sm ${done ? 'text-mist' : ''}`}>{stage.name}</span>
                      {!stage.isMandatory && <Badge tone="neutral">Optional</Badge>}
                    </div>

                    <div className="flex flex-shrink-0 items-center gap-2">
                      <Badge tone={statusTone(stage.status)}>{humanise(stage.status)}</Badge>
                      {stage.status !== 'COMPLETED' && (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            run(() =>
                              adminApi.updateProductionStage(plan.id, stage.id, {
                                status: 'COMPLETED',
                              }),
                            )
                          }
                        >
                          Complete
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-2 grid gap-2 text-xs text-fog sm:grid-cols-4">
                    <span>Est. {formatDuration(stage.estimatedMinutes)}</span>
                    <span>
                      Actual{' '}
                      {stage.actualMinutes !== null && stage.actualMinutes !== undefined
                        ? formatDuration(stage.actualMinutes)
                        : '—'}
                    </span>
                    <span>Started {formatDateTime(stage.startedAt)}</span>
                    <span>Completed {formatDateTime(stage.completedAt)}</span>
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Input
                      placeholder="Assignee"
                      defaultValue={stage.assignee ?? ''}
                      disabled={busy}
                      onBlur={(e) => {
                        const next = e.target.value.trim() || null;
                        if (next === (stage.assignee ?? null)) return;
                        void run(() =>
                          adminApi.updateProductionStage(plan.id, stage.id, { assignee: next }),
                        );
                      }}
                    />
                    <Input
                      placeholder="Notes"
                      defaultValue={stage.notes ?? ''}
                      disabled={busy}
                      onBlur={(e) => {
                        const next = e.target.value.trim() || null;
                        if (next === (stage.notes ?? null)) return;
                        void run(() =>
                          adminApi.updateProductionStage(plan.id, stage.id, { notes: next }),
                        );
                      }}
                    />
                  </div>

                  <div className="mt-2">
                    <Select
                      value={stage.status}
                      disabled={busy}
                      onChange={(e) =>
                        run(() =>
                          adminApi.updateProductionStage(plan.id, stage.id, {
                            status: e.target.value,
                          }),
                        )
                      }
                    >
                      {['PENDING', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'SKIPPED'].map((s) => (
                        <option key={s} value={s}>
                          {humanise(s)}
                        </option>
                      ))}
                    </Select>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </Panel>
  );
}

function Metric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded border border-stone/40 p-3">
      <p className="text-meta uppercase text-fog">{label}</p>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

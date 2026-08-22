import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2, Wand2 } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import type { AdminProcessStage, ProductProcessConfig } from '../../types/admin';
import { Badge, Button, ErrorNote, Field, Input, Loading, Panel, Select, Toggle } from './ui';
import { formatDuration, formatPrice } from '../format';

/**
 * Per-product manufacturing configuration.
 *
 * Each stage is a row of its own with an optional duration/cost override, so
 * the admin can see exactly where time and money go rather than just a total.
 * A blank override inherits the stage default, which means editing the stage
 * library updates every product that hasn't opted out.
 */
export default function ProcessConfig({ productId }: { productId: string }) {
  const [config, setConfig] = useState<ProductProcessConfig | null>(null);
  const [stages, setStages] = useState<AdminProcessStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState('');

  const load = async () => {
    try {
      const [cfg, lib] = await Promise.all([
        adminApi.productProcesses(productId),
        adminApi.processes({ pageSize: 100, status: 'active' }),
      ]);
      setConfig(cfg);
      setStages(lib.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load processes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const run = async (action: () => Promise<ProductProcessConfig>) => {
    setBusy(true);
    setError(null);
    try {
      setConfig(await action());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading rows={4} />;

  const attached = new Set((config?.processes ?? []).map((p) => p.stageId));
  const available = stages.filter((s) => !attached.has(s.id));
  const processes = config?.processes ?? [];

  return (
    <Panel
      title="Production processes"
      actions={
        processes.length === 0 && stages.length > 0 ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => adminApi.applyDefaultProcesses(productId))}
          >
            <Wand2 size={14} /> Apply all
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4 p-4">
        {error && <ErrorNote message={error} />}

        {processes.length === 0 ? (
          <p className="text-sm text-fog">
            No stages configured. Orders for this product will fall back to the default duration
            from settings. Add stages so its deadline reflects the real work.
          </p>
        ) : (
          <ul className="space-y-2">
            {processes.map((process, index) => (
              <li key={process.id} className="rounded border border-stone/40 p-3">
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{process.stage.name}</p>
                    <p className="text-xs text-fog">
                      Default {formatDuration(process.stage.defaultDuration)} ·{' '}
                      {formatPrice(process.stage.defaultCost)}
                    </p>
                  </div>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      onClick={() =>
                        run(() =>
                          adminApi.reorderProductProcesses(productId, [
                            { id: process.id, sortOrder: processes[index - 1]!.sortOrder },
                            { id: processes[index - 1]!.id, sortOrder: process.sortOrder },
                          ]),
                        )
                      }
                      disabled={index === 0 || busy}
                      aria-label="Move up"
                      className="rounded p-1 text-fog hover:text-pearl disabled:opacity-30"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      onClick={() =>
                        run(() =>
                          adminApi.reorderProductProcesses(productId, [
                            { id: process.id, sortOrder: processes[index + 1]!.sortOrder },
                            { id: processes[index + 1]!.id, sortOrder: process.sortOrder },
                          ]),
                        )
                      }
                      disabled={index === processes.length - 1 || busy}
                      aria-label="Move down"
                      className="rounded p-1 text-fog hover:text-pearl disabled:opacity-30"
                    >
                      <ArrowDown size={13} />
                    </button>
                    <button
                      onClick={() => run(() => adminApi.detachProcess(productId, process.id))}
                      disabled={busy}
                      aria-label="Remove stage"
                      className="rounded p-1 text-fog hover:text-red-300 disabled:opacity-30"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="Duration (min)">
                    <Input
                      type="number"
                      min={1}
                      placeholder={String(process.stage.defaultDuration)}
                      defaultValue={process.duration ?? ''}
                      disabled={busy}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const next = raw === '' ? null : Number(raw);
                        if (next === (process.duration ?? null)) return;
                        void run(() =>
                          adminApi.updateProductProcess(productId, process.id, { duration: next }),
                        );
                      }}
                    />
                  </Field>

                  <Field label="Cost">
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      placeholder={String(process.stage.defaultCost)}
                      defaultValue={process.cost ?? ''}
                      disabled={busy}
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const next = raw === '' ? null : Number(raw);
                        if (next === (process.cost != null ? Number(process.cost) : null)) return;
                        void run(() =>
                          adminApi.updateProductProcess(productId, process.id, { cost: next }),
                        );
                      }}
                    />
                  </Field>
                </div>

                <div className="mt-2 flex items-center justify-between gap-2">
                  <Toggle
                    checked={process.isMandatory}
                    onChange={(isMandatory) =>
                      run(() =>
                        adminApi.updateProductProcess(productId, process.id, { isMandatory }),
                      )
                    }
                    label="Mandatory"
                  />
                  <span className="text-xs text-fog">
                    Contributes {formatDuration(process.effectiveDuration)} ·{' '}
                    {formatPrice(process.effectiveCost ?? 0)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Totals — per unit, which is what the order then multiplies by quantity. */}
        {processes.length > 0 && (
          <div className="rounded border border-denim/40 bg-denim/10 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-mist">Total estimated time</span>
              <span className="font-medium">{formatDuration(config?.totalDuration ?? 0)}</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-mist">Total process cost</span>
              <span className="font-medium">{formatPrice(config?.totalCost ?? 0)}</span>
            </div>
            <p className="mt-2 text-xs text-fog">
              Per unit. An order multiplies this by the quantity ordered to set its deadline.
            </p>
          </div>
        )}

        {available.length > 0 && (
          <div className="flex items-end gap-2 border-t border-stone/40 pt-3">
            <Field label="Add a stage" className="flex-1">
              <Select value={adding} onChange={(e) => setAdding(e.target.value)} disabled={busy}>
                <option value="">Choose a stage…</option>
                {available.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name} ({formatDuration(stage.defaultDuration)})
                  </option>
                ))}
              </Select>
            </Field>
            <Button
              variant="secondary"
              disabled={!adding || busy}
              onClick={() => {
                const stageId = adding;
                setAdding('');
                void run(() => adminApi.attachProcess(productId, { stageId }));
              }}
            >
              <Plus size={14} /> Add
            </Button>
          </div>
        )}

        {stages.length === 0 && (
          <p className="text-xs text-fog">
            No active process stages exist yet. Create them under Processes first.
          </p>
        )}

        {processes.length > 0 && (
          <p className="text-xs text-fog">
            <Badge tone="info">Note</Badge> Changing this affects new orders only. Plans already in
            production keep the estimate they were created with.
          </p>
        )}
      </div>
    </Panel>
  );
}

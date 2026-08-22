import { useEffect, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { adminApi } from '../../services/adminApi';
import { useAdminList, useAdminResource } from '../hooks';
import type { AdminActivity, AdminPaymentConfig, AdminSettings } from '../../types/admin';
import {
  Button,
  ErrorNote,
  Field,
  Input,
  Loading,
  PageHeader,
  Pagination,
  Panel,
  SearchInput,
  Select,
  Toggle,
} from '../components/ui';
import { formatDuration, formatRelative } from '../format';

const WEEKDAYS: [number, string][] = [
  [1, 'Mon'],
  [2, 'Tue'],
  [3, 'Wed'],
  [4, 'Thu'],
  [5, 'Fri'],
  [6, 'Sat'],
  [7, 'Sun'],
];

export default function Settings() {
  const { data, loading, error, refresh } = useAdminResource<{ settings: AdminSettings }>(
    () => adminApi.settings(),
    [],
  );

  const [draft, setDraft] = useState<AdminSettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setDraft(data.settings);
  }, [data]);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    try {
      const res = await adminApi.updateSettings(draft);
      setDraft(res.settings);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
      refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !draft) return <Loading rows={8} />;
  if (error) return <ErrorNote message={error} onRetry={refresh} />;
  if (!draft) return null;

  const set = <K extends keyof AdminSettings>(key: K, value: AdminSettings[K]) =>
    setDraft({ ...draft, [key]: value });

  const toggleDay = (day: number) => {
    const has = draft.workingDays.includes(day);
    const next = has
      ? draft.workingDays.filter((d) => d !== day)
      : [...draft.workingDays, day].sort((a, b) => a - b);
    // At least one working day, or deadline maths has nothing to schedule on.
    if (next.length === 0) return;
    set('workingDays', next);
  };

  return (
    <>
      <Helmet>
        <title>Settings — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <PageHeader
        title="Settings"
        subtitle="Business rules used by deadline calculation, cart tracking and order numbering."
        actions={
          <>
            {saved && <span className="text-sm text-emerald-300">Saved</span>}
            <Button variant="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save settings'}
            </Button>
          </>
        }
      />

      {saveError && (
        <div className="mb-4">
          <ErrorNote message={saveError} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Production scheduling">
          <div className="space-y-4 p-4">
            <Field
              label="Production warning threshold (days)"
              hint="Orders due within this window show as “due soon”."
            >
              <Input
                type="number"
                min={0}
                max={60}
                value={draft.productionWarningDays}
                onChange={(e) => set('productionWarningDays', Number(e.target.value))}
              />
            </Field>

            <Field
              label="Productive minutes per working day"
              hint={`= ${formatDuration(draft.productionMinutesPerDay)} of workshop capacity per day`}
            >
              <Input
                type="number"
                min={30}
                max={1440}
                step={30}
                value={draft.productionMinutesPerDay}
                onChange={(e) => set('productionMinutesPerDay', Number(e.target.value))}
              />
            </Field>

            <div>
              <span className="mb-1.5 block text-xs uppercase tracking-wide text-fog">
                Working days
              </span>
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map(([day, label]) => (
                  <button
                    key={day}
                    onClick={() => toggleDay(day)}
                    className={`rounded border px-3 py-1.5 text-sm transition-colors ${
                      draft.workingDays.includes(day)
                        ? 'border-denim bg-denim/20 text-pearl'
                        : 'border-stone/50 text-fog hover:border-pearl'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-fog">
                Deadline calculation skips every day not selected.
              </p>
            </div>

            <Field
              label="Delivery buffer (calendar days)"
              hint="Added after production completes to set the delivery due date."
            >
              <Input
                type="number"
                min={0}
                max={60}
                value={draft.deliveryBufferDays}
                onChange={(e) => set('deliveryBufferDays', Number(e.target.value))}
              />
            </Field>

            <Field
              label="Default process duration (minutes)"
              hint="Used when a product has no process stages configured."
            >
              <Input
                type="number"
                min={1}
                value={draft.defaultProcessDuration}
                onChange={(e) => set('defaultProcessDuration', Number(e.target.value))}
              />
            </Field>
          </div>
        </Panel>

        <Panel title="Orders and storefront">
          <div className="space-y-4 p-4">
            <Field label="Currency (ISO 4217)">
              <Input
                value={draft.currency}
                maxLength={3}
                onChange={(e) => set('currency', e.target.value.toUpperCase())}
              />
            </Field>

            <Field label="Business timezone">
              <Input value={draft.timezone} onChange={(e) => set('timezone', e.target.value)} />
            </Field>

            <Field
              label="Order number prefix"
              hint="1–6 uppercase letters. Applies to new orders only."
            >
              <Input
                value={draft.orderNumberPrefix}
                maxLength={6}
                onChange={(e) => set('orderNumberPrefix', e.target.value.toUpperCase())}
              />
            </Field>

            <Field label="Default status for new orders">
              <Select
                value={draft.defaultOrderStatus}
                onChange={(e) =>
                  set('defaultOrderStatus', e.target.value as AdminSettings['defaultOrderStatus'])
                }
              >
                <option value="PENDING">Pending</option>
                <option value="CONFIRMED">Confirmed</option>
              </Select>
            </Field>

            <Field
              label="Cart abandoned after (minutes)"
              hint={`A cart idle for ${formatDuration(draft.cartAbandonedAfterMinutes)} reads as abandoned.`}
            >
              <Input
                type="number"
                min={5}
                value={draft.cartAbandonedAfterMinutes}
                onChange={(e) => set('cartAbandonedAfterMinutes', Number(e.target.value))}
              />
            </Field>

            <Toggle
              checked={draft.defaultCategoryVisible}
              onChange={(v) => set('defaultCategoryVisible', v)}
              label="New categories are visible on the storefront by default"
            />
          </div>
        </Panel>
      </div>

      <div className="mt-6">
        <PaymentGateways />
      </div>

      <div className="mt-6">
        <ActivityLog />
      </div>
    </>
  );
}

/**
 * Payment gateway status — read-only by design.
 *
 * Keys, salts and webhook secrets live in the server environment and are
 * deliberately not editable (or readable) here: this settings table is
 * admin-readable plaintext JSON, which is the wrong place for a credential.
 * What this panel shows is which gateways are enabled, which are ready, and the
 * *name* of any variable still missing.
 */
function PaymentGateways() {
  const { data, loading, error, refresh } = useAdminResource<AdminPaymentConfig>(
    () => adminApi.paymentConfig(),
    [],
  );

  if (loading && !data) return <Loading rows={4} />;
  if (error) return <ErrorNote message={error} onRetry={refresh} />;
  if (!data) return null;

  return (
    <Panel title="Payment gateways">
      <p className="mb-3 text-xs uppercase tracking-[0.16em] text-white/40">
        Selection: {data.selection.join(', ')} · mode: {data.mode}
      </p>

      <div className="space-y-3">
        {data.providers.map((provider) => (
          <div
            key={provider.id}
            className="flex flex-wrap items-start justify-between gap-3 rounded border border-white/10 p-3"
          >
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-sm">
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    provider.available
                      ? 'bg-emerald-400'
                      : provider.selected
                        ? 'bg-red-400'
                        : 'bg-white/25'
                  }`}
                />
                {provider.label}
                <span className="text-xs uppercase tracking-[0.16em] text-white/40">
                  {provider.available
                    ? 'active'
                    : provider.selected
                      ? 'selected · not configured'
                      : provider.configured
                        ? 'configured · not enabled'
                        : 'not configured'}
                </span>
              </p>

              {provider.configErrors.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-amber-300">
                  {provider.configErrors.map((reason) => (
                    <li key={reason}>· {reason}</li>
                  ))}
                </ul>
              )}

              {provider.webhookUrl && (
                <p className="mt-1 break-all text-xs text-white/40">
                  Webhook: <code>{provider.webhookUrl}</code>
                </p>
              )}
            </div>

            <p className="text-xs text-white/40">
              {[
                provider.capabilities.refunds ? 'refunds' : null,
                provider.capabilities.webhooks ? 'webhooks' : null,
                provider.capabilities.statusFetch ? 'status API' : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-white/40">
        API keys, salts and webhook secrets are configured in the server environment and are never
        shown or editable here. Change PAYMENT_PROVIDER / PAYMENT_MODE on the server to alter this
        list.
      </p>

      {data.recentEvents.length > 0 && (
        <div className="mt-5 border-t border-white/10 pt-4">
          <p className="mb-2 text-xs uppercase tracking-[0.16em] text-white/40">
            Recent provider events
          </p>
          <ul className="space-y-1 text-xs text-white/60">
            {data.recentEvents.slice(0, 10).map((event) => (
              <li key={event.id} className="flex flex-wrap gap-2">
                <span className="text-white/40">{formatRelative(event.createdAt)}</span>
                <span>{event.provider}</span>
                <span className="text-white/40">{event.type}</span>
                <span
                  className={
                    event.result === 'applied'
                      ? 'text-emerald-400'
                      : event.result === 'rejected'
                        ? 'text-red-400'
                        : 'text-white/40'
                  }
                >
                  {event.result}
                </span>
                {event.orderNumber && <span className="text-white/40">{event.orderNumber}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/** Admin audit trail — doubles as the notifications feed. */
function ActivityLog() {
  const { query, setQuery, data, loading, error, refresh } = useAdminList<AdminActivity>(
    (params) => adminApi.activity(params),
    { pageSize: 25 },
  );

  return (
    <Panel
      title="Activity log"
      actions={
        <div className="w-56">
          <SearchInput
            value={query.q}
            onChange={(q) => setQuery({ q })}
            placeholder="Search activity"
          />
        </div>
      }
    >
      {error && (
        <div className="p-4">
          <ErrorNote message={error} onRetry={refresh} />
        </div>
      )}

      {loading && !data ? (
        <Loading rows={6} />
      ) : (data?.items ?? []).length === 0 ? (
        <p className="p-4 text-sm text-fog">No activity recorded yet</p>
      ) : (
        <ul className="divide-y divide-stone/25">
          {data!.items.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm">{entry.summary}</p>
                <p className="text-xs text-fog">
                  {entry.action}
                  {entry.actorEmail ? ` · ${entry.actorEmail}` : ''}
                </p>
              </div>
              <span className="flex-shrink-0 text-xs text-fog">
                {formatRelative(entry.createdAt)}
              </span>
            </li>
          ))}
        </ul>
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
  );
}

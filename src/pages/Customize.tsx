import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { api } from '../services/api';
import { useUIStore } from '../store/uiStore';
import DenimPreview from '../components/products/DenimPreview';
import { formatPrice } from '../utils/format';
import type { CustomizationGroup, CustomizationSelection } from '../types';

/** Options, prices and the base garment all come from the API. */
export default function Customize() {
  const [groups, setGroups] = useState<CustomizationGroup[]>([]);
  const [selection, setSelection] = useState<CustomizationSelection | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [saving, setSaving] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const showToast = useUIStore((s) => s.showToast);

  useEffect(() => {
    let cancelled = false;

    api
      .getCustomizationOptions()
      .then((res) => {
        if (cancelled) return;
        setGroups(res.groups);
        // Default to each group's first option.
        const initial = res.groups.reduce((acc, g) => {
          acc[g.key] = g.options[0]?.id ?? '';
          return acc;
        }, {} as CustomizationSelection);
        setSelection(initial);
        setState('ready');
      })
      .catch(() => !cancelled && setState('error'));

    return () => {
      cancelled = true;
    };
  }, []);

  const extras = useMemo(() => {
    if (!selection) return 0;
    return groups.reduce((sum, g) => {
      const chosen = g.options.find((o) => o.id === selection[g.key]);
      return sum + (chosen?.priceDelta ?? 0);
    }, 0);
  }, [groups, selection]);

  const swatchFor = (key: keyof CustomizationSelection, fallback: string) => {
    if (!selection) return fallback;
    const group = groups.find((g) => g.key === key);
    return group?.options.find((o) => o.id === selection[key])?.swatch ?? fallback;
  };

  const handleSave = async () => {
    if (!selection) return;
    setSaving(true);
    try {
      const res = await api.saveCustomization({ productId: 'base-jean', selection });
      setReference(res.id);
      showToast('Configuration saved — the atelier will be in touch', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not save the configuration', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Helmet>
        <title>Make Your Denim — DENIMQUE</title>
        <meta
          name="description"
          content="Configure your own DENIMQUE jean: wash, stitch, patch, embroidery, fit, buttons and back pocket."
        />
        <link rel="canonical" href="https://denimque.com/customize" />
      </Helmet>

      <div className="px-6 pb-24 pt-32 lg:px-12 lg:pt-40">
        <div className="mx-auto max-w-[110rem]">
          <header className="mb-16 max-w-3xl">
            <span className="mb-4 block text-meta uppercase text-denim">Make Your Denim</span>
            <h1 className="mb-6 font-display text-display-lg">YOUR DENIM. YOUR STORY.</h1>
            <p className="text-body-lg text-mist">
              Seven decisions, one garment. Everything is cut to order in Biella and stamped with an
              edition number that belongs to you alone.
            </p>
          </header>

          {state === 'loading' && (
            <p className="text-meta uppercase text-fog">Loading the configurator…</p>
          )}

          {state === 'error' && (
            <div className="border border-stone/30 p-10">
              <h2 className="mb-3 font-display text-2xl">The configurator is offline</h2>
              <p className="mb-6 text-mist">
                Options and pricing are served by the API, so there is nothing to show until it's
                reachable. Start the API and reload.
              </p>
              <Link to="/shop" className="text-meta uppercase text-denim link-underline">
                Shop the ready-made collection
              </Link>
            </div>
          )}

          {state === 'ready' && selection && (
            <div className="grid grid-cols-1 gap-16 lg:grid-cols-[1fr_1.1fr]">
              {/* Live preview */}
              <div className="lg:sticky lg:top-28 lg:self-start">
                <div className="flex aspect-[3/4] items-center justify-center border border-stone/30 bg-charcoal p-10">
                  <DenimPreview
                    wash={swatchFor('wash', '#26374A')}
                    stitch={swatchFor('stitch', '#D8C9A3')}
                    buttons={swatchFor('buttons', '#B08D57')}
                    patch={selection.patch}
                    embroidery={selection.embroidery}
                    fit={selection.fit}
                    backPocket={selection.backPocket}
                  />
                </div>
                <p className="mt-3 text-xs text-fog">
                  Vector preview. Your finished garment is photographed and sent for approval before
                  it ships.
                </p>
              </div>

              {/* Configuration */}
              <div>
                <div className="space-y-10">
                  {groups.map((group) => (
                    <fieldset key={group.key}>
                      <legend className="mb-4 flex w-full items-baseline justify-between">
                        <span className="text-meta uppercase text-fog">{group.label}</span>
                        <span className="text-sm text-mist">
                          {group.options.find((o) => o.id === selection[group.key])?.label}
                        </span>
                      </legend>

                      <div className="flex flex-wrap gap-3">
                        {group.options.map((option) => {
                          const active = selection[group.key] === option.id;
                          return (
                            <button
                              key={option.id}
                              onClick={() =>
                                setSelection((s) => (s ? { ...s, [group.key]: option.id } : s))
                              }
                              aria-pressed={active}
                              className={`flex items-center gap-2 border px-4 py-2 text-sm transition-colors ${
                                active
                                  ? 'border-pearl text-pearl'
                                  : 'border-stone/50 text-fog hover:border-pearl/60'
                              }`}
                            >
                              {option.swatch && (
                                <span
                                  className="h-4 w-4 border border-stone/60"
                                  style={{ backgroundColor: option.swatch }}
                                  aria-hidden="true"
                                />
                              )}
                              {option.label}
                              {Boolean(option.priceDelta) && (
                                <span className="text-xs text-denim">
                                  +{formatPrice(option.priceDelta ?? 0)}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  ))}
                </div>

                <div className="mt-12 border-t border-stone/30 pt-6">
                  <div className="mb-6 flex items-baseline justify-between">
                    <span className="text-meta uppercase text-fog">Customisation total</span>
                    <span className="font-display text-2xl">
                      {extras === 0 ? 'No extras' : `+ ${formatPrice(extras)}`}
                    </span>
                  </div>

                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="w-full bg-pearl py-4 text-sm uppercase tracking-[0.18em] text-obsidian transition-colors hover:bg-white disabled:opacity-50"
                  >
                    {saving ? 'Saving…' : 'Save configuration'}
                  </button>

                  {reference && (
                    <p role="status" className="mt-4 text-sm text-denim">
                      Saved as reference <span className="font-mono">{reference}</span>. Quote this
                      when you speak to the atelier.
                    </p>
                  )}

                  <p className="mt-4 text-xs text-fog">
                    Made-to-order pieces take 4–6 weeks and are final sale. We confirm measurements
                    by email before cutting.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

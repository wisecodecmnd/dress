import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import { ArrowLeft } from 'lucide-react';
import { adminApi } from '../../services/adminApi';
import type { AdminCategory, AdminProduct } from '../../types/admin';
import {
  Button,
  ErrorNote,
  Field,
  Input,
  Loading,
  PageHeader,
  Panel,
  Select,
  Textarea,
  Toggle,
} from '../components/ui';
import ProcessConfig from '../components/ProcessConfig';

interface Draft {
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  sku: string;
  story: string;
  fabric: string;
  fit: string;
  care: string;
  shipping: string;
  price: string;
  comparePrice: string;
  color: string;
  categoryId: string;
  isLimited: boolean;
  isFeatured: boolean;
  isActive: boolean;
  editionNo: string;
  position: string;
  sizes: string;
  images: string;
  stock: Record<string, number>;
}

const emptyDraft: Draft = {
  name: '',
  slug: '',
  description: '',
  shortDescription: '',
  sku: '',
  story: '',
  fabric: '',
  fit: '',
  care: '',
  shipping: '',
  price: '',
  comparePrice: '',
  color: '',
  categoryId: '',
  isLimited: false,
  isFeatured: false,
  isActive: true,
  editionNo: '',
  position: '0',
  sizes: '',
  images: '',
  stock: {},
};

const fromProduct = (p: AdminProduct): Draft => ({
  name: p.name,
  slug: p.slug,
  description: p.description,
  shortDescription: p.shortDescription ?? '',
  sku: p.sku ?? '',
  story: p.story ?? '',
  fabric: p.fabric ?? '',
  fit: p.fit ?? '',
  care: p.care ?? '',
  shipping: p.shipping ?? '',
  price: String(p.price),
  comparePrice: p.comparePrice ? String(p.comparePrice) : '',
  color: p.color ?? '',
  categoryId: p.categoryId ?? '',
  isLimited: p.isLimited,
  isFeatured: p.isFeatured,
  isActive: p.isActive,
  editionNo: p.editionNo != null ? String(p.editionNo) : '',
  position: String(p.position),
  sizes: (p.sizes ?? []).map((s) => s.size).join(', '),
  images: (p.images ?? []).map((i) => i.url).join('\n'),
  stock: Object.fromEntries((p.inventory ?? []).map((i) => [i.size, i.quantity])),
});

/** "30, 32, 34" → ["30","32","34"] */
const parseSizes = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const parseImages = (value: string) =>
  value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url) => ({ url }));

export default function ProductEdit() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isNew = id === 'new';

  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [categories, setCategories] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    adminApi
      .categories({ pageSize: 100, sort: 'position', dir: 'asc', status: 'active' })
      .then((res) => setCategories(res.items))
      .catch(() => setCategories([]));
  }, []);

  useEffect(() => {
    if (isNew || !id) return;

    let cancelled = false;
    setLoading(true);

    adminApi
      .product(id)
      .then((res) => {
        if (!cancelled) setDraft(fromProduct(res.product));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id, isNew]);

  const sizes = parseSizes(draft.sizes);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaved(false);

    // Only send stock for sizes that still exist.
    const stock: Record<string, number> = {};
    for (const size of sizes) stock[size] = draft.stock[size] ?? 0;

    const body: Record<string, unknown> = {
      name: draft.name,
      slug: draft.slug || undefined,
      description: draft.description,
      shortDescription: draft.shortDescription || null,
      sku: draft.sku || null,
      story: draft.story || null,
      fabric: draft.fabric || null,
      fit: draft.fit || null,
      care: draft.care || null,
      shipping: draft.shipping || null,
      price: Number(draft.price),
      comparePrice: draft.comparePrice ? Number(draft.comparePrice) : null,
      color: draft.color || null,
      categoryId: draft.categoryId || null,
      isLimited: draft.isLimited,
      isFeatured: draft.isFeatured,
      isActive: draft.isActive,
      editionNo: draft.editionNo ? Number(draft.editionNo) : null,
      position: Number(draft.position) || 0,
      sizes,
      stock,
      images: parseImages(draft.images),
    };

    try {
      if (isNew) {
        const res = await adminApi.createProduct(body);
        navigate(`/admin/products/${res.product.id}`, { replace: true });
      } else {
        const res = await adminApi.updateProduct(id!, body);
        setDraft(fromProduct(res.product));
        setSaved(true);
        window.setTimeout(() => setSaved(false), 2500);
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Loading rows={10} />;
  if (error) return <ErrorNote message={error} />;

  return (
    <>
      <Helmet>
        <title>{isNew ? 'New product' : draft.name} — DENIMQUE Admin</title>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>

      <Link
        to="/admin/products"
        className="mb-4 inline-flex items-center gap-1 text-sm text-fog hover:text-pearl"
      >
        <ArrowLeft size={14} /> All products
      </Link>

      <PageHeader
        title={isNew ? 'New product' : draft.name || 'Product'}
        subtitle={isNew ? undefined : `/product/${draft.slug}`}
        actions={
          <>
            {saved && <span className="text-sm text-emerald-300">Saved</span>}
            <Button
              variant="primary"
              onClick={save}
              disabled={saving || !draft.name || !draft.description || !draft.price}
            >
              {saving ? 'Saving…' : isNew ? 'Create product' : 'Save changes'}
            </Button>
          </>
        }
      />

      {saveError && (
        <div className="mb-4">
          <ErrorNote message={saveError} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Panel title="Basics">
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Name" className="sm:col-span-2">
                <Input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>

              <Field label="Slug" hint="Leave blank to generate from the name">
                <Input
                  value={draft.slug}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                />
              </Field>

              <Field label="SKU">
                <Input
                  value={draft.sku}
                  onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                />
              </Field>

              <Field label="Category">
                <Select
                  value={draft.categoryId}
                  onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                >
                  <option value="">Uncategorised</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Colour">
                <Input
                  value={draft.color}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                />
              </Field>

              <Field label="Short description" className="sm:col-span-2">
                <Input
                  value={draft.shortDescription}
                  onChange={(e) => setDraft({ ...draft, shortDescription: e.target.value })}
                />
              </Field>

              <Field label="Description" className="sm:col-span-2">
                <Textarea
                  rows={4}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Pricing">
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Price">
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.price}
                  onChange={(e) => setDraft({ ...draft, price: e.target.value })}
                />
              </Field>

              <Field
                label="Compare-at price"
                hint="Shown struck through. Must be higher than the price."
              >
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={draft.comparePrice}
                  onChange={(e) => setDraft({ ...draft, comparePrice: e.target.value })}
                />
              </Field>
            </div>
          </Panel>

          <Panel title="Sizes and stock">
            <div className="space-y-4 p-4">
              <Field label="Sizes" hint="Comma separated, e.g. 30, 32, 34 or S, M, L">
                <Input
                  value={draft.sizes}
                  onChange={(e) => setDraft({ ...draft, sizes: e.target.value })}
                />
              </Field>

              {sizes.length > 0 && (
                <div>
                  <p className="mb-2 text-xs uppercase tracking-wide text-fog">
                    Stock per size
                  </p>
                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {sizes.map((size) => (
                      <label key={size} className="flex items-center gap-2">
                        <span className="w-10 flex-shrink-0 text-sm text-mist">{size}</span>
                        <Input
                          type="number"
                          min={0}
                          value={draft.stock[size] ?? 0}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              stock: { ...draft.stock, [size]: Number(e.target.value) },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-fog">
                    A product with no sizes has no inventory rows and is treated as unlimited.
                  </p>
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Images">
            <div className="p-4">
              <Field label="Image URLs" hint="One per line. The first is the primary image.">
                <Textarea
                  rows={4}
                  value={draft.images}
                  onChange={(e) => setDraft({ ...draft, images: e.target.value })}
                  placeholder={'https://…\nhttps://…'}
                />
              </Field>
              {parseImages(draft.images).length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {parseImages(draft.images).map((img, i) => (
                    <img
                      key={`${img.url}-${i}`}
                      src={img.url}
                      alt=""
                      className="h-16 w-16 rounded object-cover"
                    />
                  ))}
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Product story">
            <div className="grid gap-4 p-4 sm:grid-cols-2">
              <Field label="Story" className="sm:col-span-2">
                <Textarea
                  rows={3}
                  value={draft.story}
                  onChange={(e) => setDraft({ ...draft, story: e.target.value })}
                />
              </Field>
              <Field label="Fabric">
                <Textarea
                  rows={2}
                  value={draft.fabric}
                  onChange={(e) => setDraft({ ...draft, fabric: e.target.value })}
                />
              </Field>
              <Field label="Fit">
                <Textarea
                  rows={2}
                  value={draft.fit}
                  onChange={(e) => setDraft({ ...draft, fit: e.target.value })}
                />
              </Field>
              <Field label="Care">
                <Textarea
                  rows={2}
                  value={draft.care}
                  onChange={(e) => setDraft({ ...draft, care: e.target.value })}
                />
              </Field>
              <Field label="Shipping">
                <Textarea
                  rows={2}
                  value={draft.shipping}
                  onChange={(e) => setDraft({ ...draft, shipping: e.target.value })}
                />
              </Field>
            </div>
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Visibility">
            <div className="space-y-3 p-4">
              <Toggle
                checked={draft.isActive}
                onChange={(isActive) => setDraft({ ...draft, isActive })}
                label="Active on storefront"
              />
              <Toggle
                checked={draft.isFeatured}
                onChange={(isFeatured) => setDraft({ ...draft, isFeatured })}
                label="Featured"
              />
              <Toggle
                checked={draft.isLimited}
                onChange={(isLimited) => setDraft({ ...draft, isLimited })}
                label="Limited edition"
              />

              {draft.isLimited && (
                <Field label="Edition number">
                  <Input
                    type="number"
                    min={0}
                    value={draft.editionNo}
                    onChange={(e) => setDraft({ ...draft, editionNo: e.target.value })}
                  />
                </Field>
              )}

              <Field label="Display order">
                <Input
                  type="number"
                  min={0}
                  value={draft.position}
                  onChange={(e) => setDraft({ ...draft, position: e.target.value })}
                />
              </Field>
            </div>
          </Panel>

          {/* Process configuration needs a saved product to attach to. */}
          {isNew ? (
            <Panel title="Production processes">
              <p className="p-4 text-sm text-fog">
                Save the product first, then configure which manufacturing stages it needs and how
                long each takes.
              </p>
            </Panel>
          ) : (
            <ProcessConfig productId={id!} />
          )}
        </div>
      </div>
    </>
  );
}

import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { asyncHandler, HttpError } from '../utils/http.js';

/**
 * The configurator's option catalogue. It lives server-side so pricing can't be
 * edited in the browser — the client renders whatever this returns and the
 * price delta is recomputed here on save.
 */
const GROUPS = [
  {
    key: 'wash',
    label: 'Denim wash',
    options: [
      { id: 'raw-indigo', label: 'Raw indigo', swatch: '#26374A' },
      { id: 'washed-blue', label: 'Washed blue', swatch: '#5C7C99' },
      { id: 'stone', label: 'Stone', swatch: '#8C93A0' },
      { id: 'black-rinse', label: 'Black rinse', swatch: '#1D1D20', priceDelta: 800 },
    ],
  },
  {
    key: 'stitch',
    label: 'Stitch colour',
    options: [
      { id: 'ecru', label: 'Ecru', swatch: '#D8C9A3' },
      { id: 'tonal', label: 'Tonal', swatch: '#3E5164' },
      { id: 'copper', label: 'Copper', swatch: '#B87333' },
      { id: 'black', label: 'Black', swatch: '#141416' },
    ],
  },
  {
    key: 'patch',
    label: 'Patch',
    options: [
      { id: 'leather', label: 'Vegetable-tanned leather' },
      { id: 'black-leather', label: 'Black leather', priceDelta: 600 },
      { id: 'jacron', label: 'Jacron', priceDelta: -400 },
      { id: 'rounded', label: 'Rounded leather', priceDelta: 600 },
      { id: 'none', label: 'No patch' },
    ],
  },
  {
    key: 'embroidery',
    label: 'Embroidery',
    options: [
      { id: 'none', label: 'None' },
      { id: 'monogram', label: 'Monogram', priceDelta: 1200 },
      { id: 'signature', label: 'Signature script', priceDelta: 1800 },
    ],
  },
  {
    key: 'fit',
    label: 'Fit',
    options: [
      { id: 'relaxed', label: 'Relaxed' },
      { id: 'straight', label: 'Straight' },
      { id: 'slim', label: 'Slim' },
      { id: 'skinny', label: 'Skinny' },
    ],
  },
  {
    key: 'buttons',
    label: 'Buttons & rivets',
    options: [
      { id: 'antique-brass', label: 'Antique brass', swatch: '#B08D57' },
      { id: 'copper', label: 'Copper', swatch: '#B87333' },
      { id: 'gunmetal', label: 'Gunmetal', swatch: '#4A4E54', priceDelta: 500 },
      { id: 'silver', label: 'Brushed silver', swatch: '#C7CBD1', priceDelta: 500 },
    ],
  },
  {
    key: 'backPocket',
    label: 'Back pocket',
    options: [
      { id: 'arcuate', label: 'Arcuate' },
      { id: 'curved', label: 'Curved' },
      { id: 'v-stitch', label: 'V-stitch' },
      { id: 'square', label: 'Square' },
      { id: 'none', label: 'Plain' },
    ],
  },
] as const;

export const getOptions = asyncHandler(async (_req, res) => {
  res.json({ groups: GROUPS });
});

const keys = GROUPS.map((g) => g.key);

export const saveSchema = z.object({
  productId: z.string().min(1).optional(),
  selection: z.record(z.string(), z.string()).refine(
    (sel) => keys.every((k) => typeof sel[k] === 'string' && sel[k].length > 0),
    { message: 'Every option must be chosen' },
  ),
});

export const saveCustomization = asyncHandler(async (req, res) => {
  const { productId, selection } = req.body as z.infer<typeof saveSchema>;

  // Validate each choice against the catalogue and price it server-side.
  let priceDelta = new Prisma.Decimal(0);

  for (const group of GROUPS) {
    const chosen = group.options.find((o) => o.id === selection[group.key]);
    if (!chosen) {
      throw HttpError.badRequest(`"${selection[group.key]}" is not a valid ${group.label} option`);
    }
    priceDelta = priceDelta.add('priceDelta' in chosen ? (chosen.priceDelta ?? 0) : 0);
  }

  // Only link a real catalogue product; the configurator's placeholder id isn't one.
  const product =
    productId && productId !== 'base-jean'
      ? await prisma.product.findUnique({ where: { id: productId }, select: { id: true } })
      : null;

  const saved = await prisma.customization.create({
    data: {
      userId: req.auth?.sub ?? null,
      productId: product?.id ?? null,
      selection,
      priceDelta,
    },
    select: { id: true },
  });

  res.status(201).json({ id: saved.id, priceDelta: priceDelta.toFixed(2) });
});

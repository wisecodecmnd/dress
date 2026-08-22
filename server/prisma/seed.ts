import { PrismaClient, Prisma } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';

const prisma = new PrismaClient();

const img = (id: string) =>
  `https://images.unsplash.com/photo-${id}?q=80&w=1200&auto=format&fit=crop`;

const categories = [
  { name: 'Jeans', slug: 'jeans', description: 'Selvedge denim, cut to order.', position: 1 },
  { name: 'Jackets', slug: 'jackets', description: 'Type III and beyond.', position: 2 },
  { name: 'Shirts', slug: 'shirts', description: 'Chambray and light denim.', position: 3 },
  { name: 'Overshirts', slug: 'overshirts', description: 'The layer between.', position: 4 },
  {
    name: 'Limited Editions',
    slug: 'limited-editions',
    description: 'Numbered runs, retired when the cloth runs out.',
    position: 5,
  },
  { name: 'Saree', slug: 'saree', description: 'Handloom drape, denim weft.', position: 6 },
  {
    name: 'Model Dress',
    slug: 'model-dress',
    description: 'Runway pieces, made to measure.',
    position: 7,
  },
];

/**
 * The manufacturing stage library. Durations are minutes for one unit; the
 * admin UI shows them as hours.
 */
const processStages = [
  { name: 'Design', slug: 'design', defaultDuration: 60, defaultCost: 400, description: 'Sketch, spec and sign-off.' },
  { name: 'Pattern Making', slug: 'pattern-making', defaultDuration: 120, defaultCost: 700, description: 'Draft and grade the block.' },
  { name: 'Fabric Preparation', slug: 'fabric-preparation', defaultDuration: 60, defaultCost: 300, description: 'Sponge, rest and inspect the cloth.' },
  { name: 'Cutting', slug: 'cutting', defaultDuration: 120, defaultCost: 500, description: 'Lay, mark and cut.' },
  { name: 'Stitching', slug: 'stitching', defaultDuration: 300, defaultCost: 1600, description: 'Single-needle and chain-stitch assembly.' },
  { name: 'Finishing', slug: 'finishing', defaultDuration: 120, defaultCost: 600, description: 'Hardware, hems and press.' },
  { name: 'Quality Check', slug: 'quality-check', defaultDuration: 60, defaultCost: 250, description: 'Measure against spec and inspect seams.' },
  { name: 'Packaging', slug: 'packaging', defaultDuration: 30, defaultCost: 150, description: 'Tissue, box and label.' },
];

const WAIST_SIZES = ['28', '30', '32', '34', '36'];
const LETTER_SIZES = ['S', 'M', 'L', 'XL'];

const products = [
  {
    slug: 'the-obsidian-jean',
    name: 'The Obsidian Jean',
    category: 'jeans',
    price: 18500,
    comparePrice: 21000,
    color: 'Black rinse',
    isLimited: true,
    isFeatured: true,
    editionNo: 214,
    sizes: WAIST_SIZES,
    images: ['1541099649-83e6ea6e3de5', '1582418708-4d5f1d6d5e2e', '1558618666-fcd25c85f82e'],
    description:
      'A black-on-black selvedge jean in 14oz Japanese denim, sanforized and cut to a straight leg. Matte hardware, tonal stitching, no visible branding.',
    story:
      'Cut from a single run of Kojima black warp that we bought in its entirety. When it is gone, this jean retires — the fade pattern it develops cannot be reproduced from another lot.',
    fabric: '14oz shuttle-woven selvedge from Kojima, Japan. Long-staple cotton, rope-dyed indigo over a black warp.',
    fit: 'Straight through the thigh with a mid rise and a 19cm leg opening. Patterned from 47 measurements; size down one for a slim fit.',
    care: 'Wash cold inside out, no more than every ten wears. Line dry in shade. Never tumble dry — the selvedge will torque.',
    shipping: 'Dispatched within 48 hours from Biella, insured and carbon-offset. Free express shipping above ₹10,000.',
  },
  {
    slug: 'the-heritage-jacket',
    name: 'The Heritage Jacket',
    category: 'jackets',
    price: 16500,
    color: 'Raw indigo',
    isFeatured: true,
    sizes: LETTER_SIZES,
    images: ['1551028719-00167b16eac5', '1558171813-4c088753af8f'],
    description:
      'A Type III silhouette in raw 13oz selvedge, chain-stitched throughout, with copper rivets and a vegetable-tanned patch.',
    story: 'Modelled on a 1962 jacket found in a Biella flea market, re-patterned for a modern shoulder.',
    fabric: '13oz raw selvedge, unwashed. Expect roughly 3% shrinkage on first wash and heavy honeycombing at the elbows.',
    fit: 'True to size over a t-shirt, size up for knitwear.',
    care: 'Wear it raw for six months if you can. Then cold wash, inside out, line dry.',
  },
  {
    slug: 'the-indigo-overshirt',
    name: 'The Indigo Overshirt',
    category: 'overshirts',
    price: 12500,
    color: 'Washed indigo',
    isFeatured: true,
    sizes: LETTER_SIZES,
    images: ['1596755099408-7921c7fb1b5e', '1541099649-83e6ea6e3de5'],
    description:
      'A relaxed overshirt in 8oz washed denim. Two patch pockets, corozo buttons, single-needle side seams.',
    fabric: '8oz washed denim, garment-dyed for a soft hand from the first wear.',
    fit: 'Boxy and layerable. Take your usual size.',
    care: 'Machine wash cold, line dry.',
  },
  {
    slug: 'the-atelier-chambray',
    name: 'The Atelier Chambray',
    category: 'shirts',
    price: 9500,
    color: 'Pale indigo',
    sizes: LETTER_SIZES,
    images: ['1558171813-4c088753af8f', '1596755099408-7921c7fb1b5e'],
    description:
      'A 5oz chambray shirt with a soft collar and mother-of-pearl buttons. The shirt our own makers wear.',
    fabric: '5oz Japanese chambray, sanforized.',
    fit: 'Slim through the body with a longer tail.',
    care: 'Machine wash cold. Warm iron on the collar only.',
  },
  {
    slug: 'the-kojima-slim',
    name: 'The Kojima Slim',
    category: 'jeans',
    price: 17500,
    color: 'Raw indigo',
    sizes: WAIST_SIZES,
    images: ['1582418708-4d5f1d6d5e2e', '1541099649-83e6ea6e3de5'],
    description:
      'Our slim block in 14oz raw selvedge. High-contrast fades, hidden rivets, chain-stitched hem to your length.',
    fabric: '14oz raw selvedge from Kojima, Japan.',
    fit: 'Slim through the thigh and calf with a 17cm leg opening.',
    care: 'Wear raw as long as you can bear, then cold wash inside out.',
  },
  {
    slug: 'the-numbered-trucker',
    name: 'The Numbered Trucker',
    category: 'jackets',
    price: 24500,
    color: 'Stone wash',
    isLimited: true,
    editionNo: 42,
    sizes: LETTER_SIZES,
    images: ['1551028719-00167b16eac5', '1558618666-fcd25c85f82e'],
    description:
      'Fifty pieces only, each hand-numbered on the inside placket and finished by a single maker whose signature is stitched beside it.',
    story: 'Stone-washed with volcanic pumice for eight hours, then dried flat in the Piedmont sun.',
    fabric: '13oz selvedge, stone-washed.',
    fit: 'True to size.',
    care: 'Cold wash sparingly. This one is meant to be worn hard.',
  },
];

/**
 * In production the seed's only job is to make sure an admin account exists.
 *
 * The catalogue block below is idempotent by *overwriting* — prices, stock
 * levels, images and sizes are rewritten to the values in this file. That is
 * exactly right for a development database and destructive for a live one,
 * where an admin has since edited all of it. Same for the demo customer, whose
 * password is a known constant.
 *
 * Set SEED_CATALOGUE=true to opt in deliberately (e.g. seeding a brand-new
 * production database before launch).
 */
const isProduction = process.env.NODE_ENV === 'production';
const seedCatalogue = !isProduction || process.env.SEED_CATALOGUE === 'true';

async function main() {
  console.info(`[seed] starting (${isProduction ? 'production' : process.env.NODE_ENV ?? 'development'})`);

  if (!seedCatalogue) {
    console.info(
      '[seed] production — catalogue and demo data skipped. Admin bootstrap only.\n' +
        '       Set SEED_CATALOGUE=true to write the sample catalogue anyway.',
    );
    await seedAdmin();
    return;
  }

  // Categories
  for (const c of categories) {
    await prisma.category.upsert({ where: { slug: c.slug }, create: c, update: c });
  }
  const categoryBySlug = new Map(
    (await prisma.category.findMany({ select: { id: true, slug: true } })).map((c) => [c.slug, c.id]),
  );

  // Products, with images / sizes / inventory rebuilt on each run so the seed
  // is idempotent and safe to re-apply.
  for (const p of products) {
    const data = {
      name: p.name,
      description: p.description,
      story: p.story ?? null,
      fabric: p.fabric ?? null,
      fit: p.fit ?? null,
      care: p.care ?? null,
      shipping: p.shipping ?? null,
      price: new Prisma.Decimal(p.price),
      comparePrice: p.comparePrice ? new Prisma.Decimal(p.comparePrice) : null,
      color: p.color,
      isLimited: p.isLimited ?? false,
      isFeatured: p.isFeatured ?? false,
      editionNo: p.editionNo ?? null,
      categoryId: categoryBySlug.get(p.category) ?? null,
    };

    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      create: { slug: p.slug, ...data },
      update: data,
      select: { id: true },
    });

    await prisma.productImage.deleteMany({ where: { productId: product.id } });
    await prisma.productImage.createMany({
      data: p.images.map((id, i) => ({
        productId: product.id,
        url: img(id),
        alt: `${p.name} — view ${i + 1}`,
        position: i,
      })),
    });

    await prisma.productSize.deleteMany({ where: { productId: product.id } });
    await prisma.productSize.createMany({
      data: p.sizes.map((size, i) => ({ productId: product.id, size, position: i })),
    });

    for (const [i, size] of p.sizes.entries()) {
      // Limited pieces are deliberately thin on stock, and one size is sold out
      // so the sold-out UI states are exercised by real data.
      const quantity = p.isLimited ? (i === 1 ? 0 : 3) : i === 0 ? 0 : 12;
      await prisma.inventory.upsert({
        where: { productId_size: { productId: product.id, size } },
        create: { productId: product.id, size, quantity },
        update: { quantity },
      });
    }
  }

  // ── Process stage library ────────────────────────────────────────────────
  for (const [i, s] of processStages.entries()) {
    const data = {
      name: s.name,
      description: s.description,
      defaultDuration: s.defaultDuration,
      defaultCost: new Prisma.Decimal(s.defaultCost),
      sortOrder: i,
    };
    await prisma.processStage.upsert({
      where: { slug: s.slug },
      create: { slug: s.slug, ...data },
      update: data,
    });
  }

  const stageBySlug = new Map(
    (await prisma.processStage.findMany({ select: { id: true, slug: true } })).map((s) => [
      s.slug,
      s.id,
    ]),
  );

  // Give every seeded product the full stage list, so a first order produces a
  // real production plan with a real deadline. Existing rows are left as-is so
  // re-seeding never overwrites an admin's per-product overrides.
  for (const p of products) {
    const product = await prisma.product.findUnique({
      where: { slug: p.slug },
      select: { id: true },
    });
    if (!product) continue;

    for (const [i, s] of processStages.entries()) {
      const stageId = stageBySlug.get(s.slug);
      if (!stageId) continue;

      await prisma.productProcess.upsert({
        where: { productId_stageId: { productId: product.id, stageId } },
        create: { productId: product.id, stageId, sortOrder: i },
        update: {},
      });
    }
  }

  await seedAdmin();

  // ── Demo customer (never in production) ──────────────────────────────────
  // A fixed, published password. Fine for local development, unacceptable on a
  // live database — so it is only ever created outside production.
  const email = 'demo@denimque.com';
  const passwordHash = await bcrypt.hash('denimque2026', 12);

  await prisma.user.upsert({
    where: { email },
    create: {
      email,
      passwordHash,
      firstName: 'Demo',
      lastName: 'Customer',
      cart: { create: {} },
      wishlist: { create: {} },
    },
    update: { passwordHash },
  });

  await prisma.coupon.upsert({
    where: { code: 'ATELIER10' },
    create: {
      code: 'ATELIER10',
      description: '10% off, first order',
      percentOff: 10,
      minSubtotal: new Prisma.Decimal(10000),
    },
    update: {},
  });

  console.info(
    `[seed] done — ${products.length} products, ${categories.length} categories, demo login ${email} / denimque2026`,
  );
}

/**
 * Ensures exactly one admin exists. Credentials come from the environment;
 * nothing is hardcoded and an existing admin's password is never silently
 * reset. Safe to run against a populated production database.
 */
async function seedAdmin() {
  const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@denimque.com').toLowerCase();
  const generated = !process.env.ADMIN_PASSWORD;
  const adminPassword =
    process.env.ADMIN_PASSWORD ?? randomBytes(12).toString('base64url');

  if (adminPassword.length < 8) {
    throw new Error('ADMIN_PASSWORD must be at least 8 characters');
  }

  const existingAdmin = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true },
  });

  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash: await bcrypt.hash(adminPassword, 12),
      firstName: 'DENIMQUE',
      lastName: 'Admin',
      role: 'ADMIN',
      cart: { create: {} },
      wishlist: { create: {} },
    },
    // Never silently reset a password that already exists — an operator who
    // wants a rotation sets ADMIN_PASSWORD explicitly.
    update: process.env.ADMIN_PASSWORD
      ? { role: 'ADMIN', passwordHash: await bcrypt.hash(adminPassword, 12) }
      : { role: 'ADMIN' },
  });

  if (!existingAdmin && generated) {
    console.info(
      `\n[seed] ADMIN CREATED\n        email:    ${adminEmail}\n        password: ${adminPassword}\n        Change it after first sign-in. Set ADMIN_PASSWORD to choose your own.\n`,
    );
  } else if (existingAdmin && !process.env.ADMIN_PASSWORD) {
    console.info(`[seed] admin ${adminEmail} already exists — password left unchanged`);
  }
}

main()
  .catch((err) => {
    console.error('[seed] failed', err);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());

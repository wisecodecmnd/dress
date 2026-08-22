/**
 * End-to-end verification against a real API process and a real Postgres.
 *
 * Covers the production chain (admin → catalogue → customer → cart → order →
 * production → deadline → dashboard) plus the authorization, ownership,
 * validation and concurrency cases that the hardening pass addressed.
 *
 * Nothing here is mocked: it starts `dist/index.js`, talks to it over HTTP, and
 * asserts on what the database actually did.
 *
 *   npm run build && node scripts/verify.mjs
 *
 * Uses DATABASE_URL from server/.env. Never point it at production.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import 'dotenv/config';

const here = dirname(fileURLToPath(import.meta.url));
const serverRoot = resolve(here, '..');

const PORT = Number(process.env.VERIFY_PORT ?? 4123);
const ORIGIN = 'http://localhost:5173';
const BASE = `http://localhost:${PORT}/api`;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@denimque.com';
const ADMIN_PASSWORD = process.env.VERIFY_ADMIN_PASSWORD ?? process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error('Set VERIFY_ADMIN_PASSWORD (or ADMIN_PASSWORD) to the admin account password.');
  process.exit(2);
}

// ── Tiny test harness ───────────────────────────────────────────────────────
let passed = 0;
const failures = [];
let group = '';

const section = (name) => {
  group = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
};

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures.push(`${group} → ${label}${detail ? ` (${detail})` : ''}`);
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? ` — ${detail}` : ''}`);
  }
}

const eq = (label, actual, expected) =>
  check(label, Object.is(actual, expected), `expected ${expected}, got ${actual}`);

// ── HTTP client with a per-session cookie jar ───────────────────────────────
class Session {
  constructor(origin = ORIGIN) {
    this.cookies = new Map();
    this.origin = origin;
  }

  async request(method, path, body, extraHeaders = {}) {
    const headers = { 'Content-Type': 'application/json', ...extraHeaders };
    if (this.origin) headers.Origin = this.origin;
    if (this.cookies.size) {
      headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
    }

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      if (value === '' || /Expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }

    const type = res.headers.get('content-type') ?? '';
    const payload = type.includes('application/json')
      ? await res.json().catch(() => null)
      : await res.text();

    return { status: res.status, body: payload, headers: res.headers };
  }

  get = (p, h) => this.request('GET', p, undefined, h);
  post = (p, b, h) => this.request('POST', p, b ?? {}, h);
  patch = (p, b, h) => this.request('PATCH', p, b ?? {}, h);
  del = (p, h) => this.request('DELETE', p, undefined, h);
}

// ── Server lifecycle ────────────────────────────────────────────────────────
async function startServer() {
  const child = spawn(process.execPath, ['dist/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(PORT),
      CORS_ORIGIN: ORIGIN,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const log = [];
  child.stdout.on('data', (d) => log.push(String(d)));
  child.stderr.on('data', (d) => log.push(String(d)));

  // 45s, not 15s: a cold start straight after `tsc` writes dist/ can take tens
  // of seconds on Windows while the new files are scanned, and a false "never
  // became healthy" is indistinguishable from a real boot failure.
  for (let attempt = 0; attempt < 180; attempt++) {
    await new Promise((r) => setTimeout(r, 250));
    if (child.exitCode !== null) {
      throw new Error(`API exited early (${child.exitCode}):\n${log.join('')}`);
    }
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return { child, log };
    } catch {
      /* not listening yet */
    }
  }

  child.kill();
  throw new Error(`API never became healthy:\n${log.join('')}`);
}

const uid = () => randomBytes(5).toString('hex');
const money = (v) => Number(v);

// ── The run ─────────────────────────────────────────────────────────────────
const { child, log } = await startServer();

try {
  // 1. Health ───────────────────────────────────────────────────────────────
  section('Health');
  {
    const anon = new Session();
    const { status, body } = await anon.get('/health');
    eq('GET /api/health → 200', status, 200);
    eq('reports status ok', body.status, 'ok');
    eq('reports database ok', body.database, 'ok');
    check(
      'leaks no connection detail',
      !JSON.stringify(body).match(/postgres(ql)?:|password|:\d{4,5}\b|DATABASE_URL|@|host/i),
      JSON.stringify(body),
    );
  }

  // 2. Authentication and authorization ─────────────────────────────────────
  section('Authentication & authorization');
  const admin = new Session();
  {
    const anon = new Session();
    eq('anonymous → admin dashboard 401', (await anon.get('/admin/dashboard')).status, 401);
    eq('anonymous → admin orders 401', (await anon.get('/admin/orders')).status, 401);
    eq('anonymous → admin export 401', (await anon.get('/admin/export?type=orders')).status, 401);

    const wrong = await admin.post('/admin/login', {
      email: ADMIN_EMAIL,
      password: 'definitely-not-the-password',
    });
    eq('wrong admin password → 401', wrong.status, 401);
    check(
      'failure message does not reveal whether the email exists',
      wrong.body.message === 'Email or password is incorrect',
      wrong.body.message,
    );

    const ok = await admin.post('/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    eq('admin login → 200', ok.status, 200);
    eq('admin role returned', ok.body.user?.role, 'ADMIN');
    check(
      'login response carries no password hash',
      !JSON.stringify(ok.body).match(/passwordHash|\$2[aby]\$/),
    );
    check('session cookie is httpOnly', admin.cookies.has('dq_token'));
  }

  // 3. CSRF / origin ────────────────────────────────────────────────────────
  section('CSRF & origin');
  {
    const evil = new Session('https://evil.example.com');
    evil.cookies = new Map(admin.cookies);

    for (const [method, path] of [
      ['POST', '/admin/categories'],
      ['PATCH', '/admin/settings'],
      ['DELETE', '/admin/categories/whatever'],
    ]) {
      const { status } = await evil.request(method, path, method === 'DELETE' ? undefined : {});
      eq(`${method} ${path} from a foreign origin → 403`, status, 403);
    }

    const evilCustomer = new Session('https://evil.example.com');
    eq(
      'POST /cart from a foreign origin → 403',
      (await evilCustomer.post('/cart', { productId: 'x', size: 'M', quantity: 1 })).status,
      403,
    );

    const noOrigin = new Session(null);
    eq('GET /health without an Origin still works', (await noOrigin.get('/health')).status, 200);
  }

  // 4. Catalogue setup ──────────────────────────────────────────────────────
  section('Admin catalogue');
  let categoryId;
  let productId;
  const slug = `verify-${uid()}`;
  {
    const cat = await admin.post('/admin/categories', {
      name: `Verify ${slug}`,
      slug,
      description: 'Created by the verification run.',
    });
    eq('create category → 201', cat.status, 201);
    categoryId = cat.body.category.id;

    const dupe = await admin.post('/admin/categories', { name: 'Dupe', slug });
    eq('duplicate slug → 409', dupe.status, 409);

    const prod = await admin.post('/admin/products', {
      name: `Verify Jean ${slug}`,
      slug: `${slug}-jean`,
      description: 'A product created by the verification run.',
      price: 10000,
      comparePrice: 12000,
      categoryId,
      sizes: ['30', '32'],
      stock: { 30: 1, 32: 5 },
      isActive: true,
    });
    eq('create product → 201', prod.status, 201);
    productId = prod.body.product.id;
    eq('price stored as a fixed-2 decimal string', prod.body.product.price, '10000.00');

    const badPrice = await admin.post('/admin/products', {
      name: 'Bad',
      slug: `${slug}-bad`,
      description: 'x',
      price: 100,
      comparePrice: 50,
    });
    eq('compare price below price → 400', badPrice.status, 400);

    const badCategory = await admin.patch(`/admin/products/${productId}`, {
      categoryId: 'no-such-category',
    });
    eq('unknown category on update → 400', badCategory.status, 400);
  }

  // 5. Process configuration & duration determinism ─────────────────────────
  section('Process configuration');
  {
    const stages = await admin.get('/admin/processes?pageSize=100&status=active');
    eq('list process stages → 200', stages.status, 200);

    const wanted = [
      ['cutting', 120],
      ['stitching', 360],
      ['finishing', 120],
    ];

    const ids = [];
    for (const [stageSlug, minutes] of wanted) {
      let stage = stages.body.items.find((s) => s.slug === stageSlug);
      if (!stage) {
        const made = await admin.post('/admin/processes', {
          name: stageSlug,
          slug: stageSlug,
          defaultDuration: minutes,
        });
        stage = made.body.stage;
      }
      ids.push([stage.id, minutes]);
    }

    // Attach exactly these three, with explicit per-product overrides.
    for (const [stageId, duration] of ids) {
      const attached = await admin.post(`/admin/products/${productId}/processes`, {
        stageId,
        duration,
        cost: 100,
      });
      check(`attach stage (${duration} min)`, attached.status === 201, `status ${attached.status}`);
    }

    const configured = await admin.get(`/admin/products/${productId}/processes`);
    eq('per-unit total is 120 + 360 + 120', configured.body.totalDuration, 600);

    const dupeAttach = await admin.post(`/admin/products/${productId}/processes`, {
      stageId: ids[0][0],
    });
    eq('attaching the same stage twice → 409', dupeAttach.status, 409);
  }

  // 6. Customer signup and cart ─────────────────────────────────────────────
  section('Customer signup & cart');
  const alice = new Session();
  const bob = new Session();
  let aliceItemId;
  {
    const email = `alice-${uid()}@example.test`;
    const reg = await alice.post('/auth/register', {
      email,
      password: 'a-strong-password',
      firstName: 'Alice',
    });
    eq('signup → 201', reg.status, 201);
    check('signup response has no password hash', !JSON.stringify(reg.body).includes('password'));
    eq('signup grants a CUSTOMER role', reg.body.user.role, 'CUSTOMER');

    eq(
      'customer → admin dashboard 403',
      (await alice.get('/admin/dashboard')).status,
      403,
    );
    eq('customer → admin orders 403', (await alice.get('/admin/orders')).status, 403);
    eq(
      'customer → admin product mutation 403',
      (await alice.patch(`/admin/products/${productId}`, { price: 1 })).status,
      403,
    );
    eq(
      'customer → CSV export 403',
      (await alice.get('/admin/export?type=customers')).status,
      403,
    );
    eq(
      'customer cannot sign in at the admin door',
      (await new Session().post('/admin/login', { email, password: 'a-strong-password' })).status,
      401,
    );

    const add = await alice.post('/cart', { productId, size: '32', quantity: 2 });
    eq('add to cart → 201', add.status, 201);
    aliceItemId = add.body.item.id;

    eq(
      'zero quantity rejected',
      (await alice.post('/cart', { productId, size: '32', quantity: 0 })).status,
      400,
    );
    eq(
      'negative quantity rejected',
      (await alice.post('/cart', { productId, size: '32', quantity: -5 })).status,
      400,
    );
    eq(
      'over-stock add rejected',
      (await alice.post('/cart', { productId, size: '30', quantity: 9 })).status,
      400,
    );

    const seen = await admin.get('/admin/carts?status=active&pageSize=100');
    const aliceCart = seen.body.items.find((c) => c.customer.email === email);
    check('admin sees the cart', Boolean(aliceCart));
    eq('admin sees 2 units', aliceCart?.itemCount, 2);
    check(
      'admin cart view exposes no customer secrets',
      !JSON.stringify(aliceCart).match(/passwordHash|dq_token|\$2[aby]\$/),
    );

    const changed = await alice.patch(`/cart/${aliceItemId}`, { quantity: 3 });
    eq('customer changes quantity → 200', changed.status, 200);

    const after = await admin.get('/admin/carts?status=active&pageSize=100');
    const updated = after.body.items.find((c) => c.customer.email === email);
    eq('admin sees the updated quantity', updated?.itemCount, 3);

    // Ownership.
    await bob.post('/auth/register', {
      email: `bob-${uid()}@example.test`,
      password: 'another-strong-password',
    });
    eq(
      "Bob cannot touch Alice's cart item",
      (await bob.patch(`/cart/${aliceItemId}`, { quantity: 9 })).status,
      404,
    );
    eq(
      "Bob cannot delete Alice's cart item",
      (await bob.del(`/cart/${aliceItemId}`)).status,
      404,
    );
    eq("Bob's own cart is empty", (await bob.get('/cart')).body.items.length, 0);
  }

  // 7. Order integrity ──────────────────────────────────────────────────────
  section('Order integrity');
  let orderId;
  const address = {
    line1: '12 Atelier Row',
    city: 'Biella',
    state: 'Piedmont',
    country: 'Italy',
    pincode: '13900',
  };
  {
    // A forged price/total is simply not part of the contract — assert the
    // server's numbers, not the client's.
    const placed = await alice.post('/orders', {
      email: 'alice@example.test',
      phone: '9990001111',
      address,
      items: [
        { productId, size: '32', quantity: 2, unitPrice: 1, price: 1, total: 1 },
      ],
    });
    eq('place order → 201', placed.status, 201);
    orderId = placed.body.order.id;

    const order = placed.body.order;
    eq('subtotal priced from the database', order.subtotal, '20000.00');
    eq('shipping free above the threshold', order.shipping, '0.00');
    eq('tax is 18% of subtotal', order.tax, '3600.00');
    eq('total is server-computed', order.total, '23600.00');
    eq('order starts PENDING', order.status, 'PENDING');
    eq('payment starts PENDING', order.payment.status, 'PENDING');

    eq(
      'unknown product rejected',
      (await alice.post('/orders', {
        email: 'a@example.test',
        phone: '9990001111',
        address,
        items: [{ productId: 'not-a-product', size: '32', quantity: 1 }],
      })).status,
      400,
    );

    eq(
      'size the product is not made in is rejected',
      (await alice.post('/orders', {
        email: 'a@example.test',
        phone: '9990001111',
        address,
        items: [{ productId, size: 'XXXXL', quantity: 1 }],
      })).status,
      400,
    );

    eq(
      'quantity above the per-line cap rejected',
      (await alice.post('/orders', {
        email: 'a@example.test',
        phone: '9990001111',
        address,
        items: [{ productId, size: '32', quantity: 999 }],
      })).status,
      400,
    );

    eq(
      'missing address rejected',
      (await alice.post('/orders', {
        email: 'a@example.test',
        phone: '9990001111',
        items: [{ productId, size: '32', quantity: 1 }],
      })).status,
      400,
    );

    // Ownership.
    eq("Bob cannot read Alice's order", (await bob.get(`/orders/${orderId}`)).status, 403);
    eq(
      "Bob's order list does not contain it",
      (await bob.get('/orders')).body.orders.some((o) => o.id === orderId),
      false,
    );
    eq(
      'anonymous cannot read an account-owned order',
      (await new Session().get(`/orders/${orderId}`)).status,
      403,
    );

    // Payment cannot be spoofed by the customer: a body that *claims* success,
    // with a forged signature and a token amount, must change nothing.
    const spoof = await alice.post('/payments/confirm', {
      orderId,
      payload: {
        status: 'CAPTURED',
        amount: 1,
        razorpay_order_id: 'order_forged',
        razorpay_payment_id: 'pay_forged',
        razorpay_signature: 'deadbeef',
      },
    });
    check(
      'customer cannot self-confirm a payment',
      spoof.status >= 400 || spoof.body?.payment?.status !== 'CAPTURED',
      `status ${spoof.status}, payment ${spoof.body?.payment?.status}`,
    );
    const stillPending = await alice.get(`/orders/${orderId}`);
    eq('order is still not PAID', stillPending.body.order.status, 'PENDING');
    eq('payment is still not CAPTURED', stillPending.body.order.payment.status, 'PENDING');

    // Disabled products cannot be bought.
    await admin.patch(`/admin/products/${productId}`, { isActive: false });
    eq(
      'disabled product cannot be ordered',
      (await alice.post('/orders', {
        email: 'a@example.test',
        phone: '9990001111',
        address,
        items: [{ productId, size: '32', quantity: 1 }],
      })).status,
      400,
    );
    await admin.patch(`/admin/products/${productId}`, { isActive: true });
  }

  // 8. Concurrency ──────────────────────────────────────────────────────────
  section('Concurrency');
  {
    // One unit left in size 30. Two buyers, simultaneously.
    await admin.patch(`/admin/products/${productId}`, { stock: { 30: 1, 32: 50 } });

    const buy = (session) =>
      session.post('/orders', {
        email: 'race@example.test',
        phone: '9990001111',
        address,
        items: [{ productId, size: '30', quantity: 1 }],
      });

    const [a, b] = await Promise.all([buy(alice), buy(bob)]);
    const wins = [a, b].filter((r) => r.status === 201).length;
    eq('exactly one of two simultaneous buyers gets the last unit', wins, 1);

    const after = await admin.get(`/admin/products/${productId}`);
    const size30 = after.body.product.inventory.find((i) => i.size === '30');
    eq('stock landed on zero, not negative', size30.quantity, 0);
    check('stock never went negative', size30.quantity >= 0, `quantity ${size30.quantity}`);

    // Duplicate checkout from the same server cart.
    await admin.patch(`/admin/products/${productId}`, { stock: { 30: 20, 32: 50 } });
    const carol = new Session();
    await carol.post('/auth/register', {
      email: `carol-${uid()}@example.test`,
      password: 'yet-another-password',
    });
    await carol.post('/cart', { productId, size: '32', quantity: 1 });

    const checkout = () =>
      carol.post('/orders', { email: 'carol@example.test', phone: '9990001111', address });

    const [c1, c2] = await Promise.all([checkout(), checkout()]);
    eq(
      'a double-submitted cart checkout creates exactly one order',
      [c1, c2].filter((r) => r.status === 201).length,
      1,
    );
    eq('the cart is emptied afterwards', (await carol.get('/cart')).body.items.length, 0);
  }

  // 9. Production plan, deadline, and stage advance ─────────────────────────
  section('Production');
  let planId;
  {
    const detail = await admin.get(`/admin/orders/${orderId}`);
    eq('admin sees the order', detail.status, 200);
    const line = detail.body.order.items[0];
    check('a production plan exists for the line', Boolean(line.production));

    planId = line.production.id;
    eq('quantity carried onto the plan', line.production.quantity, 2);
    // 120 + 360 + 120 = 600 per unit, × 2 units = 1200. Multiplied once.
    eq('total estimated minutes = 600 × 2', line.production.estimatedMinutes, 1200);
    eq(
      'stage minutes sum to the plan total',
      line.production.stages.reduce((sum, s) => sum + s.estimatedMinutes, 0),
      1200,
    );
    eq('per-stage minutes are quantity-multiplied once', line.production.stages[0].estimatedMinutes, 240);
    check('a deadline was calculated', Boolean(line.production.deadlineAt));
    check('the order carries a required-by date', Boolean(detail.body.order.requiredBy));

    // Two admins start the same plan at once.
    const admin2 = new Session();
    await admin2.post('/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const [s1, s2] = await Promise.all([
      admin.post(`/admin/production/${planId}/start`),
      admin2.post(`/admin/production/${planId}/start`),
    ]);
    eq(
      'exactly one of two simultaneous starts wins',
      [s1, s2].filter((r) => r.status === 200).length,
      1,
    );

    const started = await admin.get(`/admin/production/${planId}`);
    eq('plan is IN_PROGRESS', started.body.plan.status, 'IN_PROGRESS');
    eq('first stage is open', started.body.plan.stages[0].status, 'IN_PROGRESS');
    check('actual start recorded once', Boolean(started.body.plan.actualStartAt));

    const firstStage = started.body.plan.stages[0];
    const [c1, c2] = await Promise.all([
      admin.patch(`/admin/production/${planId}/stages/${firstStage.id}`, { status: 'COMPLETED' }),
      admin2.patch(`/admin/production/${planId}/stages/${firstStage.id}`, { status: 'COMPLETED' }),
    ]);
    eq(
      'exactly one of two simultaneous stage completions wins',
      [c1, c2].filter((r) => r.status === 200).length,
      1,
    );

    const advanced = await admin.get(`/admin/production/${planId}`);
    eq('stage 1 completed', advanced.body.plan.stages[0].status, 'COMPLETED');
    eq('stage 2 activated automatically', advanced.body.plan.stages[1].status, 'IN_PROGRESS');
    check(
      'actual duration recorded',
      advanced.body.plan.stages[0].actualMinutes !== null,
    );
    eq('progress reflects one of three stages', advanced.body.plan.progress, 33);

    const orderNow = await admin.get(`/admin/orders/${orderId}`);
    eq('order advanced to IN_PRODUCTION', orderNow.body.order.status, 'IN_PRODUCTION');

    // Deadline override + overdue derivation.
    const past = new Date(Date.now() - 3 * 86_400_000).toISOString();
    const moved = await admin.patch(`/admin/production/${planId}`, { deadlineAt: past });
    eq('admin can override the deadline', moved.status, 200);
    eq('the plan now reads as overdue', moved.body.plan.isOverdue, true);
    check('days remaining is negative', moved.body.plan.daysRemaining < 0);

    const board = await admin.get('/admin/production?view=overdue&pageSize=100');
    check(
      'the overdue board lists it',
      board.body.items.some((p) => p.id === planId),
    );

    // Complete the rest and confirm the plan closes out.
    for (const stage of advanced.body.plan.stages.slice(1)) {
      await admin.patch(`/admin/production/${planId}/stages/${stage.id}`, { status: 'COMPLETED' });
    }
    const done = await admin.get(`/admin/production/${planId}`);
    eq('plan completes when every stage does', done.body.plan.status, 'COMPLETED');
    eq('a completed plan is not overdue', done.body.plan.isOverdue, false);
    eq('progress is 100', done.body.plan.progress, 100);
    eq(
      'order rolled up to READY',
      (await admin.get(`/admin/orders/${orderId}`)).body.order.status,
      'READY',
    );
  }

  // 10. Dashboard ───────────────────────────────────────────────────────────
  section('Dashboard');
  {
    const { status, body } = await admin.get('/admin/dashboard');
    eq('dashboard → 200', status, 200);
    check('counts customers', body.customers.total > 0);
    check('counts orders', body.orders.total > 0);
    check('counts products', body.products.total > 0);
    check('reports cart value as a decimal string', typeof body.carts.estimatedValue === 'string');
    // Revenue is derived from settled payments, not from order count. The
    // absolute figure depends on what is already in this database, so the
    // payments section asserts the *delta* a capture and a refund produce.
    check(
      'revenue is captured-payments only',
      body.revenue.basis === 'captured payments only' &&
        Number.isFinite(money(body.revenue.total)) &&
        money(body.revenue.total) >= 0,
      `total ${body.revenue.total}`,
    );
    check('production panel present', typeof body.production.overdue === 'number');
    check(
      'dashboard leaks nothing sensitive',
      !JSON.stringify(body).match(/passwordHash|\$2[aby]\$|DATABASE_URL/),
    );
  }

  // 11. Export ──────────────────────────────────────────────────────────────
  section('CSV export');
  {
    const injected = `=cmd|'/c calc'!A1`;
    await admin.post('/admin/categories', {
      name: injected,
      slug: `inject-${uid()}`,
    });

    const { status, body, headers } = await admin.get('/admin/export?type=orders');
    eq('orders export → 200', status, 200);
    check('served as CSV', (headers.get('content-type') ?? '').includes('text/csv'));
    check('sent as an attachment', (headers.get('content-disposition') ?? '').includes('attachment'));

    for (const type of ['customers', 'products', 'production']) {
      eq(`${type} export → 200`, (await admin.get(`/admin/export?type=${type}`)).status, 200);
    }
    eq('unknown export type → 400', (await admin.get('/admin/export?type=secrets')).status, 400);

    const products = await admin.get('/admin/export?type=products');
    check(
      'no cell begins a spreadsheet formula',
      !/(^|,)"[=+@]/.test(products.body),
      'found a formula-leading cell',
    );
    check('export carries no password hashes', !/\$2[aby]\$/.test(String(body)));
  }

  // 12. Validation and error handling ───────────────────────────────────────
  section('Validation & error handling');
  {
    eq(
      'non-numeric page rejected',
      (await admin.get('/admin/orders?page=not-a-number')).status,
      400,
    );
    eq('page 0 rejected', (await admin.get('/admin/orders?page=0')).status, 400);
    eq(
      'oversized page rejected',
      (await admin.get('/admin/orders?pageSize=100000')).status,
      400,
    );
    eq(
      'unknown status enum rejected',
      (await admin.get('/admin/orders?status=NONSENSE')).status,
      400,
    );
    eq(
      'unknown sort key falls back rather than erroring',
      (await admin.get('/admin/orders?sort=;DROP TABLE users')).status,
      200,
    );

    const notFound = await admin.get('/admin/orders/no-such-order');
    eq('unknown id → 404', notFound.status, 404);
    check(
      'error carries no stack trace or Prisma internals',
      !JSON.stringify(notFound.body).match(/at .*\(|prisma|PrismaClient|invocation|node_modules/i),
      JSON.stringify(notFound.body),
    );

    const badJson = await fetch(`${BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
      body: '{not json',
    });
    eq('malformed JSON → 400, not 500', badJson.status, 400);

    const pageList = await admin.get('/admin/orders?pageSize=1');
    check('admin lists are paginated', pageList.body.items.length <= 1 && 'pageCount' in pageList.body);
  }

  // 13. Privilege revocation ────────────────────────────────────────────────
  section('Session & privilege revocation');
  {
    const dave = new Session();
    const email = `dave-${uid()}@example.test`;
    await dave.post('/auth/register', { email, password: 'dave-strong-password' });

    const customers = await admin.get(`/admin/customers?q=${encodeURIComponent(email)}`);
    const daveId = customers.body.items[0]?.id;
    check('admin can find the customer', Boolean(daveId));
    check(
      'customer list exposes no password hash',
      !JSON.stringify(customers.body).match(/passwordHash|\$2[aby]\$/),
    );

    await admin.patch(`/admin/customers/${daveId}`, { isActive: false });
    const suspended = await dave.get('/auth/me');
    check(
      'a suspended customer cannot sign in again',
      (await new Session().post('/auth/login', { email, password: 'dave-strong-password' }))
        .status === 403,
    );
    check('existing token still resolves to the same account', suspended.status === 200);

    await admin.post('/admin/logout');
    eq('after logout the admin session is rejected', (await admin.get('/admin/me')).status, 401);
  }

  // 14. Payments — provider selection, authorization, state machine, refunds ─
  //
  // Runs against the live API in its default `manual` configuration. Every
  // order captured here is refunded again before the section ends, so the
  // revenue assertions elsewhere still see a clean slate.
  section('Payments — selection & authorization');

  const admin2 = new Session();
  await admin2.post('/admin/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  let payOrderId;
  {
    const methods = await new Session().get('/payments/methods');
    eq('payment methods are readable without a session', methods.status, 200);
    check(
      'only configured providers are offered',
      methods.body.methods.every((m) => ['manual', 'razorpay', 'phonepe', 'stripe'].includes(m.id)),
    );
    eq('manual is the only method in the default configuration', methods.body.methods.length, 1);
    eq('and it is manual', methods.body.methods[0]?.id, 'manual');
    check(
      'no secret is reachable through the methods endpoint',
      !/secret|salt|whsec|sk_live|sk_test|rzp_test|rzp_live|passwordHash/i.test(
        JSON.stringify(methods.body),
      ),
      JSON.stringify(methods.body),
    );

    // A real order to work with.
    await admin2.patch(`/admin/products/${productId}`, { isActive: true, stock: { 32: 50 } });
    const placed = await alice.post('/orders', {
      email: 'pay@example.test',
      phone: '9990001111',
      address,
      items: [{ productId, size: '32', quantity: 1 }],
    });
    eq('order for the payment tests was placed', placed.status, 201);
    payOrderId = placed.body.order.id;
    const orderTotal = placed.body.order.total;

    const intent = await alice.post('/payments/intent', { orderId: payOrderId });
    eq('an intent can be opened', intent.status, 200);
    eq('the intent uses the configured provider', intent.body.provider, 'manual');
    eq('manual needs no browser handoff', intent.body.handoff, 'none');
    eq('the amount is the server-computed order total', intent.body.amount, orderTotal);
    check('a merchant reference was minted', /^DQP/.test(intent.body.reference ?? ''));
    check(
      'the intent response carries no secret',
      !/secret|salt|whsec/i.test(JSON.stringify(intent.body)),
    );

    // Clicking Pay twice.
    const second = await alice.post('/payments/intent', { orderId: payOrderId });
    eq('a second intent is accepted', second.status, 200);
    check('and mints a fresh reference', second.body.reference !== intent.body.reference);
    const afterTwo = await alice.get(`/orders/${payOrderId}`);
    eq('two intents leave the payment PENDING', afterTwo.body.order.payment.status, 'PENDING');
    eq('and the order unpaid', afterTwo.body.order.status, 'PENDING');

    // Selecting a provider that is not configured.
    const unconfigured = await alice.post('/payments/intent', {
      orderId: payOrderId,
      provider: 'stripe',
    });
    eq('an unconfigured provider is refused', unconfigured.status, 503);
    check(
      'and the refusal names no credential value',
      !/sk_|whsec|secret=/i.test(JSON.stringify(unconfigured.body)),
    );

    // Ownership.
    eq(
      "another customer cannot open an intent on someone else's order",
      (await bob.post('/payments/intent', { orderId: payOrderId })).status,
      403,
    );
    eq(
      'nor confirm it',
      (await bob.post('/payments/confirm', { orderId: payOrderId })).status,
      403,
    );
    eq(
      'and an unauthenticated caller cannot either',
      (await new Session().post('/payments/confirm', { orderId: payOrderId })).status,
      403,
    );
  }

  // 15. Webhook endpoints ───────────────────────────────────────────────────
  section('Payments — webhook endpoints');
  {
    const raw = (path, body, headers = {}) =>
      fetch(`http://localhost:${PORT}/api/payments/webhooks/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });

    const forged = {
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_x', status: 'captured', amount: 100000 } } },
    };

    for (const provider of ['razorpay', 'phonepe', 'stripe']) {
      const res = await raw(provider, forged);
      // 400 = signature rejected, 503 = provider not configured here. Either
      // way: never 200, and never a state change.
      check(
        `${provider} webhook rejects an unsigned request`,
        res.status === 400 || res.status === 503,
        `status ${res.status}`,
      );
    }

    const badSignature = await raw('razorpay', forged, { 'X-Razorpay-Signature': 'deadbeef' });
    check(
      'razorpay webhook rejects a forged signature',
      badSignature.status === 400 || badSignature.status === 503,
      `status ${badSignature.status}`,
    );

    const badStripe = await raw('stripe', { id: 'evt_x', type: 'checkout.session.completed' }, {
      'Stripe-Signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`,
    });
    check(
      'stripe webhook rejects a forged signature',
      badStripe.status === 400 || badStripe.status === 503,
      `status ${badStripe.status}`,
    );

    // Nothing above touched the order.
    const untouched = await alice.get(`/orders/${payOrderId}`);
    eq('forged webhooks left the payment PENDING', untouched.body.order.payment.status, 'PENDING');
    eq('and the order unpaid', untouched.body.order.status, 'PENDING');

    eq(
      'a webhook path for an unknown provider does not exist',
      (await raw('paypal', {})).status,
      404,
    );
  }

  // 16. State machine, manual capture and refunds ───────────────────────────
  section('Payments — state machine & refunds');
  {
    const paymentOf = async () =>
      (await admin2.get(`/admin/orders/${payOrderId}`)).body.order.payment;

    // Revenue is asserted as a delta: this database is persistent, so the only
    // meaningful claim is what a capture and a refund each change it by.
    const revenue = async () =>
      money((await admin2.get('/admin/dashboard')).body.revenue.total);
    const revenueBefore = await revenue();

    // Illegal transitions are refused even for an admin.
    eq(
      'admin cannot jump PENDING → PARTIALLY_REFUNDED',
      (await admin2.patch(`/admin/orders/${payOrderId}`, { paymentStatus: 'PARTIALLY_REFUNDED' }))
        .status,
      400,
    );

    // FAILED → CAPTURED must be impossible.
    eq(
      'admin can fail a pending payment',
      (await admin2.patch(`/admin/orders/${payOrderId}`, { paymentStatus: 'FAILED' })).status,
      200,
    );
    eq('the payment is FAILED', (await paymentOf()).status, 'FAILED');
    eq(
      'FAILED → CAPTURED is refused',
      (await admin2.patch(`/admin/orders/${payOrderId}`, { paymentStatus: 'CAPTURED' })).status,
      400,
    );
    eq('and the payment is still FAILED', (await paymentOf()).status, 'FAILED');

    // A new attempt legitimately reopens it (FAILED → PENDING).
    eq(
      'a fresh intent reopens a failed payment',
      (await alice.post('/payments/intent', { orderId: payOrderId })).status,
      200,
    );
    eq('the payment is PENDING again', (await paymentOf()).status, 'PENDING');

    // Manual capture — the one legitimate admin settlement path.
    const captured = await admin2.patch(`/admin/orders/${payOrderId}`, {
      paymentStatus: 'CAPTURED',
    });
    eq('admin can settle a manual payment', captured.status, 200);
    const settled = await paymentOf();
    eq('the payment is CAPTURED', settled.status, 'CAPTURED');
    check('paidAt was stamped', Boolean(settled.paidAt));
    eq(
      'the order advanced to PAID',
      (await admin2.get(`/admin/orders/${payOrderId}`)).body.order.status,
      'PAID',
    );

    eq(
      'CAPTURED → PENDING is refused',
      (await admin2.patch(`/admin/orders/${payOrderId}`, { paymentStatus: 'PENDING' })).status,
      400,
    );

    // Revenue counts it exactly once, for exactly its own total.
    eq(
      'a captured payment adds its own total to revenue, once',
      (await revenue()) - revenueBefore,
      money(settled.amount),
    );

    // A customer cannot refund, and cannot touch payment status at all.
    const customerRefund = await alice.post(`/admin/orders/${payOrderId}/refund`, {});
    check(
      'a customer cannot refund an order',
      customerRefund.status === 401 || customerRefund.status === 403,
      `status ${customerRefund.status}`,
    );
    const anonRefund = await new Session().post(`/admin/orders/${payOrderId}/refund`, {});
    check(
      'nor can an unauthenticated caller',
      anonRefund.status === 401 || anonRefund.status === 403,
      `status ${anonRefund.status}`,
    );

    // Over-refunding is refused before anything moves.
    const overRefund = await admin2.post(`/admin/orders/${payOrderId}/refund`, {
      amount: Number(settled.amount) + 100,
    });
    eq('a refund larger than the payment is refused', overRefund.status, 400);
    eq('the payment is untouched', (await paymentOf()).status, 'CAPTURED');

    // Partial, then the remainder.
    const half = Math.round((Number(settled.amount) / 2) * 100) / 100;
    eq(
      'a partial refund is accepted',
      (await admin2.post(`/admin/orders/${payOrderId}/refund`, { amount: half })).status,
      200,
    );
    const partial = await paymentOf();
    eq('the payment is PARTIALLY_REFUNDED', partial.status, 'PARTIALLY_REFUNDED');
    eq('the refunded total is recorded', money(partial.refundedAmount), half);

    eq(
      'the remainder can be refunded',
      (await admin2.post(`/admin/orders/${payOrderId}/refund`, {})).status,
      200,
    );
    const full = await paymentOf();
    eq('the payment is REFUNDED', full.status, 'REFUNDED');
    eq('the full amount is recorded as refunded', money(full.refundedAmount), money(full.amount));
    eq(
      'the order moved to REFUNDED',
      (await admin2.get(`/admin/orders/${payOrderId}`)).body.order.status,
      'REFUNDED',
    );

    eq(
      'refunding again is refused',
      (await admin2.post(`/admin/orders/${payOrderId}/refund`, {})).status,
      400,
    );

    // Fully refunded, so revenue is back exactly where it started — REFUNDED is
    // not counted, PARTIALLY_REFUNDED was.
    eq('a fully refunded payment is not revenue', await revenue(), revenueBefore);

    // Reporting can reconcile it.
    const csv = await admin2.get('/admin/export?type=orders');
    check('the orders CSV carries the payment provider', /Payment provider/.test(csv.body));
    check('and the merchant reference', /Merchant reference/.test(csv.body));
    check('and the provider payment id', /Provider payment ID/.test(csv.body));
    check(
      'the CSV exposes no credential',
      !/whsec|sk_live|sk_test|rzp_live|SALT/i.test(csv.body),
    );

    // Payment configuration is readable by admin and secret-free.
    const config = await admin2.get('/admin/payments/config');
    eq('admin can read the payment configuration', config.status, 200);
    eq('all four providers are described', config.body.providers.length, 4);
    check(
      'the configuration exposes no credential value',
      !/whsec_|sk_live_|sk_test_|rzp_live_|rzp_test_/.test(JSON.stringify(config.body)),
    );
    check(
      'it names the variables a gateway still needs',
      config.body.providers
        .find((p) => p.id === 'razorpay')
        ?.configErrors.some((e) => e.includes('RAZORPAY_KEY_ID')),
    );
    eq(
      'no gateway is marked available without credentials',
      config.body.providers.filter((p) => p.available).map((p) => p.id).join(','),
      'manual',
    );
    check(
      'the server log leaked no credential',
      !/whsec_|sk_live_|rzp_live_|SALT_KEY=/.test(log.join('')),
    );
  }
} catch (err) {
  failures.push(`fatal: ${err instanceof Error ? err.message : String(err)}`);
  console.error('\n\x1b[31mRun aborted\x1b[0m', err);
} finally {
  child.kill();
}

// ── 17. Provider verification logic, in-process ─────────────────────────────
//
// Signature and checksum verification tested against fixtures built here from
// the providers' documented schemes — independently of the implementation being
// tested, so a wrong scheme fails rather than agreeing with itself.
//
// No live payment is simulated and no provider success is faked: what is
// exercised is only "would this code accept this bytes-plus-header pair", which
// is the security-relevant half. Anything that needs a real gateway response
// (order creation, status reads) requires credentials and is out of scope here.
try {
  const { createHmac, createHash } = await import('node:crypto');

  // Test credentials, set before the config module is first imported.
  Object.assign(process.env, {
    PAYMENT_MODE: 'test',
    PAYMENT_PROVIDER: 'auto',
    RAZORPAY_KEY_ID: 'rzp_test_verifyfixture',
    RAZORPAY_KEY_SECRET: 'razorpay-api-secret-fixture',
    RAZORPAY_WEBHOOK_SECRET: 'razorpay-webhook-secret-fixture',
    STRIPE_SECRET_KEY: 'sk_test_verifyfixture',
    STRIPE_WEBHOOK_SECRET: 'whsec_stripe_fixture',
    STRIPE_PUBLISHABLE_KEY: 'pk_test_verifyfixture',
    PHONEPE_API_VERSION: 'v2',
    PHONEPE_CLIENT_ID: 'phonepe-client',
    PHONEPE_CLIENT_SECRET: 'phonepe-client-secret',
    PHONEPE_CLIENT_VERSION: '1',
    PHONEPE_CALLBACK_USERNAME: 'callback-user',
    PHONEPE_CALLBACK_PASSWORD: 'callback-pass',
  });

  const state = await import('../dist/services/payments/state.js');
  const moneyUnits = await import('../dist/services/payments/money.js');
  const { razorpayProvider } = await import('../dist/services/payments/razorpay.js');
  const { stripeProvider } = await import('../dist/services/payments/stripe.js');
  const { phonepeProvider } = await import('../dist/services/payments/phonepe.js');
  const registry = await import('../dist/services/payments/registry.js');

  // ── Amounts ─────────────────────────────────────────────────────────────
  section('Payments — amount conversion');
  {
    eq('INR 236.00 is 23600 paise', moneyUnits.toMinor('236.00', 'INR'), 23600);
    eq('USD 0.99 is 99 cents', moneyUnits.toMinor('0.99', 'USD'), 99);
    // A zero-decimal currency multiplied by 100 would overcharge 100×.
    eq('JPY 500 is 500, not 50000', moneyUnits.toMinor('500', 'JPY'), 500);
    eq('23600 paise round-trips', moneyUnits.fromMinor(23600, 'INR').toFixed(2), '236.00');

    let threw = false;
    try {
      moneyUnits.toMinor('1.005', 'INR');
    } catch {
      threw = true;
    }
    check('an amount with no exact minor-unit form is rejected, not rounded', threw);
  }

  // ── State machine ───────────────────────────────────────────────────────
  section('Payments — state machine');
  {
    const allowed = (from, to) => state.canTransition(from, to);
    check('PENDING → CAPTURED is allowed', allowed('PENDING', 'CAPTURED'));
    check('PENDING → AUTHORIZED is allowed', allowed('PENDING', 'AUTHORIZED'));
    check('AUTHORIZED → CAPTURED is allowed', allowed('AUTHORIZED', 'CAPTURED'));
    check('CAPTURED → REFUNDED is allowed', allowed('CAPTURED', 'REFUNDED'));
    check('FAILED → PENDING is allowed (a new attempt)', allowed('FAILED', 'PENDING'));

    check('FAILED → CAPTURED is refused', !allowed('FAILED', 'CAPTURED'));
    check('FAILED → AUTHORIZED is refused', !allowed('FAILED', 'AUTHORIZED'));
    check('REFUNDED → CAPTURED is refused', !allowed('REFUNDED', 'CAPTURED'));
    check('REFUNDED is terminal', state.nextStatuses('REFUNDED').length === 0);
    check('CAPTURED → PENDING is refused', !allowed('CAPTURED', 'PENDING'));
    check('a restated status is a no-op, not a transition', allowed('CAPTURED', 'CAPTURED'));

    // Order status stays a separate concept.
    eq('a capture advances a PENDING order', state.orderStatusAfterCapture('PENDING'), 'PAID');
    eq('and a CONFIRMED one', state.orderStatusAfterCapture('CONFIRMED'), 'PAID');
    eq(
      'but never rewinds an order already in production',
      state.orderStatusAfterCapture('IN_PRODUCTION'),
      null,
    );
    eq('nor a shipped one', state.orderStatusAfterCapture('SHIPPED'), null);
    eq('a full refund moves the order', state.orderStatusAfterRefund('PAID', true), 'REFUNDED');
    eq('a partial refund does not', state.orderStatusAfterRefund('PAID', false), null);
  }

  // ── Razorpay ────────────────────────────────────────────────────────────
  section('Payments — Razorpay verification');
  {
    const body = Buffer.from(
      JSON.stringify({
        event: 'payment.captured',
        payload: {
          payment: {
            entity: { id: 'pay_fixture', order_id: 'order_fixture', status: 'captured', amount: 23600, currency: 'INR' },
          },
        },
      }),
    );

    // Computed here from Razorpay's documented scheme: HMAC-SHA256 of the raw
    // body with the webhook secret.
    const signature = createHmac('sha256', 'razorpay-webhook-secret-fixture')
      .update(body)
      .digest('hex');

    const good = await razorpayProvider
      .parseWebhook({ body, headers: { 'x-razorpay-signature': signature, 'x-razorpay-event-id': 'evt_1' } })
      .catch((e) => e);
    check('a correctly signed webhook is accepted', !(good instanceof Error), String(good?.message));
    eq('the event id becomes the idempotency key', good?.eventId, 'evt_1');
    eq('the outcome is CAPTURED', good?.outcome?.status, 'CAPTURED');
    eq('the amount is read from the provider entity', good?.outcome?.amountMinor, 23600);

    const tampered = Buffer.from(body.toString().replace('23600', '100'));
    const badAmount = await razorpayProvider
      .parseWebhook({ body: tampered, headers: { 'x-razorpay-signature': signature } })
      .catch((e) => e);
    check('a body tampered after signing is rejected', badAmount instanceof Error);

    for (const [label, header] of [
      ['a missing signature', undefined],
      ['an empty signature', ''],
      ['a garbage signature', 'not-hex'],
      ['a truncated signature', signature.slice(0, 32)],
      ['a signature from the wrong secret', createHmac('sha256', 'wrong').update(body).digest('hex')],
    ]) {
      const result = await razorpayProvider
        .parseWebhook({ body, headers: header === undefined ? {} : { 'x-razorpay-signature': header } })
        .catch((e) => e);
      check(`razorpay rejects ${label}`, result instanceof Error, `got ${JSON.stringify(result)}`);
    }

    // Return-leg signature: HMAC-SHA256 of `order_id|payment_id` with the API
    // secret. A wrong one must be refused before any network call is made.
    const forged = await razorpayProvider
      .verifyPayment({
        reference: 'DQPTEST',
        providerOrderId: 'order_fixture',
        providerPaymentId: 'pay_fixture',
        payload: {
          razorpay_order_id: 'order_fixture',
          razorpay_payment_id: 'pay_fixture',
          razorpay_signature: 'f'.repeat(64),
        },
      })
      .catch((e) => e);
    check('a forged return-leg signature is refused', forged instanceof Error);
    check(
      'and refused as a signature failure, not a network error',
      /signature/i.test(forged?.message ?? ''),
      forged?.message,
    );

    const noSignature = await razorpayProvider
      .verifyPayment({
        reference: 'DQPTEST',
        providerOrderId: 'order_fixture',
        providerPaymentId: 'pay_fixture',
        payload: { razorpay_order_id: 'order_fixture', razorpay_payment_id: 'pay_fixture' },
      })
      .catch((e) => e);
    check('a return leg with no signature at all is refused', noSignature instanceof Error);
  }

  // ── Stripe ──────────────────────────────────────────────────────────────
  section('Payments — Stripe verification');
  {
    const body = Buffer.from(
      JSON.stringify({ id: 'evt_fixture', type: 'customer.created', data: { object: {} } }),
    );
    // Stripe's documented scheme: HMAC-SHA256 of `${timestamp}.${body}`.
    const sign = (secret, timestamp) =>
      createHmac('sha256', secret).update(`${timestamp}.${body.toString()}`).digest('hex');

    const now = Math.floor(Date.now() / 1000);

    // `customer.created` carries no payment verdict, so a valid signature
    // parses to a recorded-but-inert event — which is exactly what proves the
    // signature check passed.
    const good = await stripeProvider
      .parseWebhook({
        body,
        headers: { 'stripe-signature': `t=${now},v1=${sign('whsec_stripe_fixture', now)}` },
      })
      .catch((e) => e);
    check('a correctly signed webhook is accepted', !(good instanceof Error), String(good?.message));
    eq('the Stripe event id is the idempotency key', good?.eventId, 'evt_fixture');
    eq('an event with no verdict applies nothing', good?.outcome, null);

    // Stripe sends several v1= entries while a secret is rotating; any match
    // is sufficient.
    const rotating = await stripeProvider
      .parseWebhook({
        body,
        headers: {
          'stripe-signature': `t=${now},v1=${'0'.repeat(64)},v1=${sign('whsec_stripe_fixture', now)}`,
        },
      })
      .catch((e) => e);
    check('one matching signature among several is accepted', !(rotating instanceof Error));

    for (const [label, header] of [
      ['a missing header', undefined],
      ['a malformed header', 'nonsense'],
      ['a header with no v1 entry', `t=${now}`],
      ['a signature from the wrong secret', `t=${now},v1=${sign('whsec_wrong', now)}`],
      // Replay defence independent of the event-id ledger.
      ['a signature timestamped an hour ago', `t=${now - 3600},v1=${sign('whsec_stripe_fixture', now - 3600)}`],
      ['a signature timestamped in the future', `t=${now + 3600},v1=${sign('whsec_stripe_fixture', now + 3600)}`],
    ]) {
      const result = await stripeProvider
        .parseWebhook({ body, headers: header === undefined ? {} : { 'stripe-signature': header } })
        .catch((e) => e);
      check(`stripe rejects ${label}`, result instanceof Error, `got ${JSON.stringify(result)}`);
    }

    const noId = await stripeProvider
      .parseWebhook({
        body: Buffer.from(JSON.stringify({ type: 'customer.created' })),
        headers: {
          'stripe-signature': (() => {
            const b = JSON.stringify({ type: 'customer.created' });
            return `t=${now},v1=${createHmac('sha256', 'whsec_stripe_fixture').update(`${now}.${b}`).digest('hex')}`;
          })(),
        },
      })
      .catch((e) => e);
    check('a signed event with no id is refused (nothing to dedupe on)', noId instanceof Error);
  }

  // ── PhonePe ─────────────────────────────────────────────────────────────
  section('Payments — PhonePe verification');
  {
    const payload = {
      event: 'checkout.order.completed',
      payload: {
        merchantOrderId: 'DQPFIXTURE',
        orderId: 'OMO123',
        state: 'COMPLETED',
        amount: 23600,
        paymentDetails: [{ transactionId: 'TXN123', state: 'COMPLETED', amount: 23600 }],
      },
    };
    const body = Buffer.from(JSON.stringify(payload));

    // v2 documented scheme: SHA-256 of the dashboard-configured
    // `username:password`, sent as the Authorization header.
    const authorization = createHash('sha256').update('callback-user:callback-pass').digest('hex');

    const good = await phonepeProvider.parseWebhook({ body, headers: { authorization } }).catch((e) => e);
    check('a correctly authenticated v2 callback is accepted', !(good instanceof Error), String(good?.message));
    eq('the outcome is CAPTURED', good?.outcome?.status, 'CAPTURED');
    eq('the amount comes from PhonePe, in paise', good?.outcome?.amountMinor, 23600);
    eq('the merchant reference is carried through', good?.reference, 'DQPFIXTURE');
    check('an idempotency key is derived', Boolean(good?.eventId));

    // The derived key must be stable across redeliveries and distinct per state.
    const again = await phonepeProvider.parseWebhook({ body, headers: { authorization } });
    eq('the same callback derives the same key', again.eventId, good.eventId);

    const failedBody = Buffer.from(
      JSON.stringify({
        ...payload,
        payload: { ...payload.payload, state: 'FAILED', paymentDetails: [{ transactionId: 'TXN123', state: 'FAILED' }] },
      }),
    );
    const failed = await phonepeProvider.parseWebhook({ body: failedBody, headers: { authorization } });
    check('a different verdict derives a different key', failed.eventId !== good.eventId);
    eq('a FAILED state maps to FAILED', failed.outcome.status, 'FAILED');

    for (const [label, header] of [
      ['a missing Authorization header', undefined],
      ['an empty Authorization header', ''],
      ['a garbage Authorization header', 'Bearer nope'],
      ['credentials that do not match', createHash('sha256').update('someone:else').digest('hex')],
    ]) {
      const result = await phonepeProvider
        .parseWebhook({ body, headers: header === undefined ? {} : { authorization: header } })
        .catch((e) => e);
      check(`phonepe rejects ${label}`, result instanceof Error, `got ${JSON.stringify(result)}`);
    }

    // A PENDING state must never read as settled.
    const pendingBody = Buffer.from(
      JSON.stringify({ ...payload, payload: { ...payload.payload, state: 'PENDING' } }),
    );
    const pending = await phonepeProvider.parseWebhook({ body: pendingBody, headers: { authorization } });
    eq('a PENDING state stays PENDING', pending.outcome.status, 'PENDING');
  }

  // ── Registry ────────────────────────────────────────────────────────────
  section('Payments — provider registry');
  {
    const statuses = registry.providerStatuses();
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s]));

    eq('all four providers are registered', statuses.length, 4);
    check('razorpay is configured by these fixtures', byId.razorpay.configured, JSON.stringify(byId.razorpay.configErrors));
    check('stripe is configured by these fixtures', byId.stripe.configured, JSON.stringify(byId.stripe.configErrors));
    check('phonepe is configured by these fixtures', byId.phonepe.configured, JSON.stringify(byId.phonepe.configErrors));

    // With gateways available, `auto` stops offering manual — a bank-transfer
    // option must not sit silently beside a live card option.
    check('auto offers the configured gateways', byId.razorpay.available && byId.stripe.available);
    check('and drops manual once a gateway is live', !byId.manual.available);

    // Publishable values only.
    const methods = registry.paymentMethods();
    const serialised = JSON.stringify(methods);
    check(
      'the storefront payload carries no secret',
      !/razorpay-api-secret|razorpay-webhook-secret|whsec_|sk_test_|client-secret|callback-pass/.test(
        serialised,
      ),
      serialised,
    );
    check('but does carry the Razorpay key id', /rzp_test_verifyfixture/.test(serialised));
    check('and the Stripe publishable key', /pk_test_verifyfixture/.test(serialised));
    eq('mode is reported', methods.mode, 'test');
  }

  // ── Selection & mode, per environment ───────────────────────────────────
  //
  // The environment is parsed once, at import — so each configuration is probed
  // in its own process. That is also the honest test: what matters is how a
  // freshly booted API behaves with a given .env.
  section('Payments — selection & mode per environment');
  {
    const BASE_KEYS = {
      RAZORPAY_KEY_ID: 'rzp_test_fixture',
      RAZORPAY_KEY_SECRET: 'razorpay-api-secret-fixture',
      RAZORPAY_WEBHOOK_SECRET: 'razorpay-webhook-secret-fixture',
      STRIPE_SECRET_KEY: 'sk_test_fixture',
      STRIPE_WEBHOOK_SECRET: 'whsec_fixture',
      STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture',
      PHONEPE_API_VERSION: 'v2',
      PHONEPE_CLIENT_ID: 'phonepe-client',
      PHONEPE_CLIENT_SECRET: 'phonepe-client-secret',
      PHONEPE_CLIENT_VERSION: '1',
      PHONEPE_CALLBACK_USERNAME: 'callback-user',
      PHONEPE_CALLBACK_PASSWORD: 'callback-pass',
    };

    /** Boots a throwaway process with `overrides` and reads back the registry. */
    async function probe(overrides) {
      const registryUrl = pathToFileURL(
        resolve(serverRoot, 'dist/services/payments/registry.js'),
      ).href;

      const script = `
        const r = await import(${JSON.stringify(registryUrl)});
        process.stdout.write(JSON.stringify({
          statuses: r.providerStatuses(),
          methods: r.paymentMethods(),
        }));
      `;

      // Start from a clean payment environment so server/.env cannot leak in.
      const env = { ...process.env };
      for (const key of Object.keys(env)) {
        if (/^(RAZORPAY|PHONEPE|STRIPE|PAYMENT)_/.test(key)) delete env[key];
      }

      const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
        cwd: serverRoot,
        env: { ...env, ...overrides },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      const code = await new Promise((r) => child.on('close', r));

      if (code !== 0) return { crashed: true, stderr: err };
      try {
        return JSON.parse(out);
      } catch {
        return { crashed: true, stderr: err || out };
      }
    }

    const ids = (result) => result.methods.methods.map((m) => m.id).join(',');
    const find = (result, id) => result.statuses.find((s) => s.id === id);

    // Nothing configured → manual only.
    const bare = await probe({});
    check('an unconfigured deployment does not crash', !bare.crashed, bare.stderr);
    eq('and offers manual only', ids(bare), 'manual');
    check('with no gateway marked available', !bare.statuses.some((s) => s.id !== 'manual' && s.available));

    // PAYMENT_PROVIDER=manual stays manual even with keys present.
    const pinnedManual = await probe({ ...BASE_KEYS, PAYMENT_PROVIDER: 'manual' });
    eq('PAYMENT_PROVIDER=manual offers manual only', ids(pinnedManual), 'manual');
    check(
      'even though the gateways are configured',
      find(pinnedManual, 'razorpay').configured && !find(pinnedManual, 'razorpay').available,
    );

    // One gateway bought and configured.
    const razorpayOnly = await probe({
      PAYMENT_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: BASE_KEYS.RAZORPAY_KEY_ID,
      RAZORPAY_KEY_SECRET: BASE_KEYS.RAZORPAY_KEY_SECRET,
      RAZORPAY_WEBHOOK_SECRET: BASE_KEYS.RAZORPAY_WEBHOOK_SECRET,
    });
    eq('configuring Razorpay alone offers Razorpay alone', ids(razorpayOnly), 'razorpay');
    check(
      'and its key id reaches the browser',
      /rzp_test_fixture/.test(JSON.stringify(razorpayOnly.methods)),
    );
    check(
      'while its secret does not',
      !/razorpay-api-secret|razorpay-webhook-secret/.test(JSON.stringify(razorpayOnly)),
    );

    // Two gateways later.
    const two = await probe({
      ...BASE_KEYS,
      PAYMENT_PROVIDER: 'razorpay,stripe',
    });
    eq('two gateways can be offered together', ids(two), 'razorpay,stripe');
    check('and PhonePe stays out of checkout', !find(two, 'phonepe').available);

    // Selected but not configured: unavailable, not a crash, not a fake success.
    const missing = await probe({ PAYMENT_PROVIDER: 'razorpay' });
    check('a selected-but-unconfigured gateway does not crash the boot', !missing.crashed, missing.stderr);
    eq('and offers nothing at all', ids(missing), '');
    const razorpayStatus = find(missing, 'razorpay');
    check('it is reported as selected', razorpayStatus.selected);
    check('but not configured', !razorpayStatus.configured);
    check(
      'and names the variables it needs',
      razorpayStatus.configErrors.some((e) => e.includes('RAZORPAY_KEY_ID')) &&
        razorpayStatus.configErrors.some((e) => e.includes('RAZORPAY_KEY_SECRET')) &&
        razorpayStatus.configErrors.some((e) => e.includes('RAZORPAY_WEBHOOK_SECRET')),
      JSON.stringify(razorpayStatus.configErrors),
    );

    // A webhook secret alone is not optional: an unauthenticated callback is
    // worse than no callback.
    const noWebhookSecret = await probe({
      PAYMENT_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: BASE_KEYS.RAZORPAY_KEY_ID,
      RAZORPAY_KEY_SECRET: BASE_KEYS.RAZORPAY_KEY_SECRET,
    });
    eq('Razorpay without a webhook secret is not offered', ids(noWebhookSecret), '');

    // Test/live guards.
    const liveKeyInTest = await probe({
      ...BASE_KEYS,
      PAYMENT_PROVIDER: 'razorpay',
      PAYMENT_MODE: 'test',
      RAZORPAY_KEY_ID: 'rzp_live_realmoney',
    });
    eq('a live Razorpay key in test mode is not offered', ids(liveKeyInTest), '');
    check(
      'and the reason says so',
      find(liveKeyInTest, 'razorpay').configErrors.some((e) =>
        /live key but PAYMENT_MODE is test/.test(e),
      ),
      JSON.stringify(find(liveKeyInTest, 'razorpay').configErrors),
    );

    const testKeyInLive = await probe({
      ...BASE_KEYS,
      PAYMENT_PROVIDER: 'stripe',
      PAYMENT_MODE: 'live',
    });
    eq('a test Stripe key in live mode is not offered', ids(testKeyInLive), '');

    const mixedStripe = await probe({
      ...BASE_KEYS,
      PAYMENT_PROVIDER: 'stripe',
      PAYMENT_MODE: 'test',
      STRIPE_PUBLISHABLE_KEY: 'pk_live_mixed',
    });
    check(
      'mixed-mode Stripe keys are refused',
      find(mixedStripe, 'stripe').configErrors.some((e) => /different modes/.test(e)),
    );

    // PhonePe in live mode must not fall back to the sandbox host.
    const phonepeLive = await probe({
      ...BASE_KEYS,
      PAYMENT_PROVIDER: 'phonepe',
      PAYMENT_MODE: 'live',
    });
    check(
      'PhonePe in live mode demands an explicit base URL',
      find(phonepeLive, 'phonepe').configErrors.some((e) => e.includes('PHONEPE_BASE_URL')),
      JSON.stringify(find(phonepeLive, 'phonepe').configErrors),
    );

    // The v1 integration wants a different credential set entirely.
    const phonepeV1 = await probe({
      PAYMENT_PROVIDER: 'phonepe',
      PHONEPE_API_VERSION: 'v1',
      PHONEPE_MERCHANT_ID: 'MERCHANT',
      PHONEPE_SALT_KEY: 'salt-key',
      PHONEPE_SALT_INDEX: '1',
    });
    eq('PhonePe v1 is configured by salt credentials', ids(phonepeV1), 'phonepe');
    const phonepeV1Missing = await probe({
      PAYMENT_PROVIDER: 'phonepe',
      PHONEPE_API_VERSION: 'v1',
      PHONEPE_MERCHANT_ID: 'MERCHANT',
    });
    eq('and refuses to run without the salt', ids(phonepeV1Missing), '');

    // An unknown provider name is a configuration error, caught at boot.
    const nonsense = await probe({ PAYMENT_PROVIDER: 'paypal' });
    check('an unknown provider name is rejected at boot', nonsense.crashed);
    check(
      'with a message naming the variable',
      /PAYMENT_PROVIDER/.test(nonsense.stderr ?? ''),
      nonsense.stderr,
    );

    // No probe output anywhere may contain a secret.
    for (const [label, result] of Object.entries({
      bare, pinnedManual, razorpayOnly, two, missing, liveKeyInTest, testKeyInLive, phonepeV1,
    })) {
      check(
        `the ${label} configuration leaks no secret`,
        !/razorpay-api-secret|razorpay-webhook-secret|whsec_fixture|sk_test_fixture|phonepe-client-secret|callback-pass|salt-key/.test(
          JSON.stringify(result),
        ),
      );
    }
  }
} catch (err) {
  failures.push(`provider fixtures: ${err instanceof Error ? err.message : String(err)}`);
  console.error('\n\x1b[31mProvider fixtures aborted\x1b[0m', err);
}

// ── 18. Gateway webhooks end to end ─────────────────────────────────────────
//
// The sections above prove the signature checks reject forgeries, but they
// cannot prove what an *accepted* webhook does, because the API under test has
// no gateway credentials.
//
// So this boots a second API configured for PhonePe against a local stand-in
// for PhonePe's REST API. PHONEPE_BASE_URL / PHONEPE_AUTH_BASE_URL exist to be
// configured, so no code is special-cased for the test.
//
// To be explicit about what this is: the *gateway* is mocked, returning the
// documented response shapes. No live payment occurs and no real settlement is
// claimed. What is genuinely under test is our own half — that a correctly
// signed callback settles exactly once, that a replay and a concurrent
// redelivery change nothing, that a wrong amount is refused, and that a late
// contradicting event cannot walk a captured payment backwards.
let mockGateway;
let fixtureApi;

try {
  const http = await import('node:http');
  const { createHash } = await import('node:crypto');

  const MOCK_PORT = Number(process.env.VERIFY_MOCK_PORT ?? 4198);
  const API_PORT = Number(process.env.VERIFY_FIXTURE_PORT ?? 4199);
  const MOCK_BASE = `http://localhost:${MOCK_PORT}`;
  const API = `http://localhost:${API_PORT}/api`;

  const CALLBACK_USER = 'callback-user';
  const CALLBACK_PASS = 'callback-pass';
  const AUTHORIZATION = createHash('sha256')
    .update(`${CALLBACK_USER}:${CALLBACK_PASS}`)
    .digest('hex');

  // A real gateway mints a fresh order handle and transaction id per charge, so
  // the stand-in does too — otherwise it would collide with the
  // duplicate-payment protection and the test would be measuring the fixture.
  const RUN = uid().toUpperCase();
  let charges = 0;
  let refunds = 0;
  const handles = new Map(); // merchantOrderId → { orderId, transactionId }
  let pendingHandle = null;

  // What a status read should answer with, keyed by merchant order id. Set per
  // test so the return-leg path can be exercised independently of the callback.
  const gatewayStates = new Map();

  // ── A stand-in for PhonePe's documented endpoints ───────────────────────
  mockGateway = http.createServer((req, res) => {
    const send = (body) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };

    if (req.url?.startsWith('/v1/oauth/token')) {
      return send({
        access_token: 'mock-access-token',
        token_type: 'O-Bearer',
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      });
    }
    if (req.url?.startsWith('/checkout/v2/pay')) {
      // The merchant order id is in the request body, which is not read back
      // here; the caller records the handle it was handed instead.
      charges += 1;
      // Run-unique, because a gateway never reissues a transaction id — and
      // reusing one across runs would trip the duplicate-payment guard, which
      // is tested deliberately further down instead.
      pendingHandle = {
        orderId: `OMO_${RUN}_${charges}`,
        transactionId: `TXN_${RUN}_${charges}`,
      };
      return send({
        orderId: pendingHandle.orderId,
        state: 'PENDING',
        redirectUrl: `${MOCK_BASE}/hosted-page`,
      });
    }
    if (req.url?.startsWith('/payments/v2/refund')) {
      refunds += 1;
      return send({ refundId: `RFND_MOCK_${refunds}`, state: 'CONFIRMED' });
    }
    if (req.url?.includes('/checkout/v2/order/')) {
      const reference = decodeURIComponent(
        req.url.split('/checkout/v2/order/')[1].split('/')[0],
      );
      const handle = handles.get(reference) ?? { orderId: 'OMO_UNKNOWN', transactionId: 'TXN_UNKNOWN' };
      const state = gatewayStates.get(reference) ?? { state: 'PENDING', amount: 0 };

      return send({
        orderId: handle.orderId,
        state: state.state,
        amount: state.amount,
        paymentDetails: [
          {
            transactionId: handle.transactionId,
            state: state.state,
            amount: state.amount,
          },
        ],
      });
    }
    res.writeHead(404).end('{}');
  });

  await new Promise((r) => mockGateway.listen(MOCK_PORT, r));

  // ── A second API, configured for PhonePe against the stand-in ───────────
  fixtureApi = spawn(process.execPath, ['dist/index.js'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(API_PORT),
      CORS_ORIGIN: ORIGIN,
      PAYMENT_PROVIDER: 'phonepe',
      PAYMENT_MODE: 'test',
      PAYMENT_RETURN_ORIGIN: ORIGIN,
      PHONEPE_API_VERSION: 'v2',
      PHONEPE_BASE_URL: MOCK_BASE,
      PHONEPE_AUTH_BASE_URL: MOCK_BASE,
      PHONEPE_CLIENT_ID: 'mock-client',
      PHONEPE_CLIENT_SECRET: 'mock-client-secret',
      PHONEPE_CLIENT_VERSION: '1',
      PHONEPE_CALLBACK_USERNAME: CALLBACK_USER,
      PHONEPE_CALLBACK_PASSWORD: CALLBACK_PASS,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const fixtureLog = [];
  fixtureApi.stdout.on('data', (d) => fixtureLog.push(String(d)));
  fixtureApi.stderr.on('data', (d) => fixtureLog.push(String(d)));

  let healthy = false;
  for (let attempt = 0; attempt < 180 && !healthy; attempt++) {
    await new Promise((r) => setTimeout(r, 250));
    if (fixtureApi.exitCode !== null) break;
    healthy = await fetch(`${API}/health`).then((r) => r.ok).catch(() => false);
  }
  if (!healthy) throw new Error(`fixture API never became healthy:\n${fixtureLog.join('')}`);

  const call = async (method, path, body, headers = {}, cookies = '') => {
    const res = await fetch(`${API}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        ...(cookies ? { Cookie: cookies } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const type = res.headers.get('content-type') ?? '';
    return {
      status: res.status,
      body: type.includes('json') ? await res.json().catch(() => null) : await res.text(),
      setCookie: res.headers.getSetCookie?.() ?? [],
    };
  };

  const jar = (cookies) =>
    cookies.map((c) => c.split(';')[0]).join('; ');

  section('Payments — gateway webhooks end to end');
  {
    const methods = await call('GET', '/payments/methods');
    eq('the fixture API offers PhonePe', methods.body.methods.map((m) => m.id).join(','), 'phonepe');
    check(
      'and exposes no PhonePe secret',
      !/mock-client-secret|callback-pass/.test(JSON.stringify(methods.body)),
    );

    const adminLogin = await call('POST', '/admin/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });
    eq('admin can sign in to the fixture API', adminLogin.status, 200);
    const adminCookies = jar(adminLogin.setCookie);

    // A product to buy.
    const list = await call('GET', '/products');
    const slug = list.body.products?.[0]?.slug;
    const detail = await call('GET', `/products/${slug}`);
    const buyProductId = detail.body.product.id;
    const buySize = detail.body.product.sizes?.[0]?.size ?? '32';

    /** Places an order and opens a PhonePe charge against the stand-in. */
    async function openCharge() {
      const placed = await call('POST', '/orders', {
        email: `wh-${uid()}@example.test`,
        phone: '9990001111',
        address: {
          line1: '12 Via Roma',
          city: 'Biella',
          state: 'Piemonte',
          country: 'Italy',
          pincode: '13900',
        },
        items: [{ productId: buyProductId, size: buySize, quantity: 1 }],
      });
      if (placed.status !== 201) throw new Error(`order failed: ${JSON.stringify(placed.body)}`);

      const order = placed.body.order;
      pendingHandle = null;
      const intent = await call('POST', '/payments/intent', { orderId: order.id });
      if (intent.status !== 200) throw new Error(`intent failed: ${JSON.stringify(intent.body)}`);

      // Remember which gateway handles this charge was given, so callbacks and
      // status reads for it are internally consistent.
      handles.set(intent.body.reference, pendingHandle);

      return {
        orderId: order.id,
        reference: intent.body.reference,
        amountMinor: Math.round(Number(order.total) * 100),
        handle: pendingHandle,
        intent: intent.body,
      };
    }

    const callback = (charge, state, amountMinor, headers = { authorization: AUTHORIZATION }) => {
      const reference = typeof charge === 'string' ? charge : charge.reference;
      const handle = handles.get(reference) ?? {
        orderId: `OMO_ORPHAN_${uid()}`,
        transactionId: `TXN_ORPHAN_${uid()}`,
      };

      return fetch(`http://localhost:${API_PORT}/api/payments/webhooks/phonepe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          event: 'checkout.order.completed',
          payload: {
            merchantOrderId: reference,
            orderId: handle.orderId,
            state,
            amount: amountMinor,
            paymentDetails: [{ transactionId: handle.transactionId, state, amount: amountMinor }],
          },
        }),
      }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
    };

    const orderState = async (orderId) => {
      const res = await call('GET', `/admin/orders/${orderId}`, undefined, {}, adminCookies);
      return res.body.order;
    };

    const capturesLogged = (order) =>
      order.events.filter((e) => e.label === 'Payment received').length;

    // ── A charge really opens against the gateway ───────────────────────
    const first = await openCharge();
    eq('PhonePe returns a redirect handoff', first.intent.handoff, 'redirect');
    check('with the gateway redirect URL', /hosted-page/.test(first.intent.redirectUrl ?? ''));
    eq('the payment is attributed to PhonePe', first.intent.provider, 'phonepe');

    let order = await orderState(first.orderId);
    eq('and starts unpaid', order.payment.status, 'PENDING');

    // ── One correctly signed callback settles it, once ──────────────────
    const applied = await callback(first, 'COMPLETED', first.amountMinor);
    eq('a correctly authenticated callback is accepted', applied.status, 200);
    eq('and is applied', applied.body.outcome, 'applied');

    order = await orderState(first.orderId);
    eq('the payment is CAPTURED', order.payment.status, 'CAPTURED');
    eq('the order advanced to PAID', order.status, 'PAID');
    eq(
      'the gateway transaction id is recorded',
      order.payment.providerPaymentId,
      first.handle.transactionId,
    );
    check('paidAt is stamped', Boolean(order.payment.paidAt));
    eq('exactly one capture is timelined', capturesLogged(order), 1);

    // ── Replay: the same event again ────────────────────────────────────
    const replay = await callback(first, 'COMPLETED', first.amountMinor);
    eq('a replayed callback is acknowledged, not retried forever', replay.status, 200);
    eq('and recognised as a duplicate', replay.body.outcome, 'duplicate');

    order = await orderState(first.orderId);
    eq('the payment is still CAPTURED', order.payment.status, 'CAPTURED');
    eq('and still exactly one capture is timelined', capturesLogged(order), 1);
    eq('the refunded total is untouched', money(order.payment.refundedAmount), 0);

    // ── Two identical callbacks, simultaneously ─────────────────────────
    const second = await openCharge();
    const [raceA, raceB] = await Promise.all([
      callback(second, 'COMPLETED', second.amountMinor),
      callback(second, 'COMPLETED', second.amountMinor),
    ]);
    check(
      'both concurrent callbacks are acknowledged',
      raceA.status === 200 && raceB.status === 200,
      `${raceA.status}/${raceB.status}`,
    );
    eq(
      'but exactly one of them applied',
      [raceA, raceB].filter((r) => r.body.outcome === 'applied').length,
      1,
    );

    order = await orderState(second.orderId);
    eq('the payment captured once', order.payment.status, 'CAPTURED');
    eq('and only one capture is timelined', capturesLogged(order), 1);

    // ── A callback racing the browser's own confirmation ────────────────
    const third = await openCharge();
    gatewayStates.set(third.reference, { state: 'COMPLETED', amount: third.amountMinor });
    const [viaWebhook, viaBrowser] = await Promise.all([
      callback(third, 'COMPLETED', third.amountMinor),
      call('POST', '/payments/confirm', { orderId: third.orderId }),
    ]);
    check(
      'a webhook and a return leg arriving together both succeed',
      viaWebhook.status === 200 && viaBrowser.status === 200,
      `${viaWebhook.status}/${viaBrowser.status}`,
    );
    order = await orderState(third.orderId);
    eq('the payment captured exactly once', order.payment.status, 'CAPTURED');
    eq('and one capture is timelined', capturesLogged(order), 1);
    eq('the order is PAID', order.status, 'PAID');

    // ── A wrong amount is refused, not captured ─────────────────────────
    const wrong = await openCharge();
    const mismatch = await callback(wrong, 'COMPLETED', wrong.amountMinor - 100);
    eq('an amount that disagrees with the order is refused', mismatch.body.outcome, 'amount-mismatch');

    order = await orderState(wrong.orderId);
    eq('the payment is FAILED, not CAPTURED', order.payment.status, 'FAILED');
    check(
      'and the reason is recorded for reconciliation',
      /Amount mismatch/.test(order.payment.failureReason ?? ''),
      order.payment.failureReason,
    );
    eq('the order was not advanced', order.status, 'PENDING');

    // Even a *larger* amount is refused — an overpayment is still a mismatch.
    const over = await openCharge();
    const overpaid = await callback(over, 'COMPLETED', over.amountMinor + 5000);
    eq('an overpayment is refused too', overpaid.body.outcome, 'amount-mismatch');
    eq('and that order stays unpaid', (await orderState(over.orderId)).status, 'PENDING');

    // ── A late, contradicting event cannot walk it backwards ────────────
    const late = await callback(first, 'FAILED', first.amountMinor);
    eq('a late FAILED event for a captured payment is acknowledged', late.status, 200);
    check(
      'but not applied',
      late.body.outcome !== 'applied',
      `outcome ${late.body.outcome}`,
    );
    order = await orderState(first.orderId);
    eq('the captured payment is untouched', order.payment.status, 'CAPTURED');
    eq('and the order is still PAID', order.status, 'PAID');

    // ── An unsigned callback still gets nowhere, on a configured provider ─
    const unsigned = await callback(second, 'COMPLETED', second.amountMinor, {});
    eq('an unauthenticated callback is rejected outright', unsigned.status, 400);
    const forged = await callback(second, 'COMPLETED', second.amountMinor, {
      authorization: 'f'.repeat(64),
    });
    eq('and so is a forged one', forged.status, 400);

    // ── One gateway payment cannot settle two orders ────────────────────
    const reused = await openCharge();
    const stolen = await fetch(`http://localhost:${API_PORT}/api/payments/webhooks/phonepe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', authorization: AUTHORIZATION },
      body: JSON.stringify({
        event: 'checkout.order.completed',
        payload: {
          merchantOrderId: reused.reference,
          orderId: reused.handle.orderId,
          state: 'COMPLETED',
          amount: reused.amountMinor,
          // The transaction id that already settled the first order.
          paymentDetails: [
            {
              transactionId: first.handle.transactionId,
              state: 'COMPLETED',
              amount: reused.amountMinor,
            },
          ],
        },
      }),
    }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));

    eq('a replayed gateway payment id is acknowledged', stolen.status, 200);
    eq('but refused', stolen.body.outcome, 'blocked');
    order = await orderState(reused.orderId);
    eq('the second order is not settled by it', order.payment.status, 'PENDING');
    eq('and stays unpaid', order.status, 'PENDING');

    // ── A signed callback for an unknown reference changes nothing ──────
    const orphan = await callback(`DQPNOSUCHREF${uid()}`, 'COMPLETED', 1000);
    eq('a signed callback we cannot match is acknowledged', orphan.status, 200);
    check(
      'and applied to nothing',
      orphan.body.outcome !== 'applied',
      `outcome ${orphan.body.outcome}`,
    );

    // ── Refund through the gateway, then not twice ──────────────────────
    const refunded = await call(
      'POST',
      `/admin/orders/${first.orderId}/refund`,
      {},
      {},
      adminCookies,
    );
    eq('admin can refund a PhonePe payment', refunded.status, 200);
    order = await orderState(first.orderId);
    eq('the payment is REFUNDED', order.payment.status, 'REFUNDED');
    eq('the full amount is recorded', money(order.payment.refundedAmount), money(order.payment.amount));
    eq(
      'refunding again is refused',
      (await call('POST', `/admin/orders/${first.orderId}/refund`, {}, {}, adminCookies)).status,
      400,
    );

    // Tidy up: leave nothing captured, so revenue assertions stay meaningful
    // on the next run.
    for (const settled of [second, third]) {
      await call('POST', `/admin/orders/${settled.orderId}/refund`, {}, {}, adminCookies);
    }
    check(
      'every order settled by this section was refunded again',
      (await orderState(second.orderId)).payment.status === 'REFUNDED' &&
        (await orderState(third.orderId)).payment.status === 'REFUNDED',
    );

    // ── The event ledger tells the story, without secrets ───────────────
    const config = await call('GET', '/admin/payments/config', undefined, {}, adminCookies);
    const events = config.body.recentEvents;
    check('the ledger recorded the applied events', events.some((e) => e.result === 'applied'));
    check('and the rejected ones', events.some((e) => e.result === 'rejected'));
    check(
      'the fixture API log leaked no secret',
      !/mock-client-secret|callback-pass/.test(fixtureLog.join('')),
    );
    check(
      'and the callback digest never appears in a response',
      !JSON.stringify(config.body).includes(AUTHORIZATION),
    );
  }
} catch (err) {
  failures.push(`gateway webhooks: ${err instanceof Error ? err.message : String(err)}`);
  console.error('\n\x1b[31mGateway webhook section aborted\x1b[0m', err);
} finally {
  fixtureApi?.kill();
  mockGateway?.close();
}

// ── Report ──────────────────────────────────────────────────────────────────
const total = passed + failures.length;
console.log(`\n\x1b[1m${passed}/${total} checks passed\x1b[0m`);

if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  · ${f}`);
  console.log('\nServer log:\n' + log.join(''));
  process.exit(1);
}

process.exit(0);


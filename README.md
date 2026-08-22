# DENIMQUE

A premium denim e-commerce experience: a scroll-driven fashion film on the home
page, an editorial shop, made-to-order customisation, and a production-shaped
Express + Prisma API behind it.

Built to the spec in `DENIMQUE Production Website Master Prompt.docx`. The shop
page's interaction architecture follows `landing page refference.html` (preloader
→ sticky film → chapter panels → HUD progress → gallery → CTA → footer).

---

## Stack

| Layer     | Choice                                        |
| --------- | --------------------------------------------- |
| Frontend  | React 18, Vite, TypeScript, Tailwind CSS      |
| Motion    | GSAP + ScrollTrigger, Lenis smooth scroll     |
| State     | Zustand (cart, wishlist, auth, UI)            |
| Backend   | Node, Express, TypeScript                     |
| Database  | PostgreSQL via Prisma                         |
| Auth      | JWT in an httpOnly cookie                     |
| Payments  | Provider registry (manual / Razorpay / PhonePe / Stripe) |
| Email     | Transport abstraction (log / Resend / SMTP)   |

---

## Running it

### 1. Frontend

```bash
npm install
npm run dev
```

Serves on http://localhost:5173 and proxies `/api` to `http://localhost:4000`.

The marketing pages render without the API. The shop, product, account,
checkout and customise pages need it — they show an explicit error state rather
than fake data when it's unreachable.

### 2. Database

Requires a PostgreSQL instance. With Docker:

```bash
docker run --name denimque-db -e POSTGRES_PASSWORD=postgres -p 5432:5432 -d postgres:16
```

No Docker or Postgres installed? The API ships a development-only cluster
(`embedded-postgres`, a devDependency) that runs a real PostgreSQL from
downloaded binaries. Leave it running in its own terminal:

```bash
cd server
npm run db:dev
```

It prints the `DATABASE_URL` to paste into `server/.env`, stores its data in
`server/.pgdata`, and `npm run db:reset` starts over from an empty cluster.
This is for local development only — in production `DATABASE_URL` points at a
managed Postgres exactly as before, and nothing in `src/` imports it.

### 3. API

```bash
cd server
cp .env.example .env
```

Then edit `server/.env` — at minimum `DATABASE_URL` and a `JWT_SECRET` of 32+
characters. Generate one with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

Apply the schema, seed the catalogue, and start:

```bash
cd server
npm install
npm run prisma:migrate
npm run seed
npm run dev
```

The seed creates 7 categories, 6 products (with images, sizes and stock levels
that include deliberate sold-out sizes), the 8 manufacturing process stages,
a full process configuration for every product, a coupon, and a demo account:

```
demo@denimque.com / denimque2026
```

**All of that is development-only.** With `NODE_ENV=production` the seed writes
nothing but the admin account: the catalogue block is idempotent by
*overwriting*, which would reset prices, stock and images an admin has since
edited, and the demo account's password is a published constant. See
[Deploying to production](#deploying-to-production).

### 3a. Admin account

The seed also creates the admin user. Credentials come from the environment —
nothing is hardcoded, and an existing admin's password is never silently reset:

```bash
cd server
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='a-strong-password' npm run seed
```

Omit `ADMIN_PASSWORD` and a random one is generated and printed once. Sign in
at `/admin/login`.

Admin routes live under `/admin/*` and every `/api/admin/*` endpoint is gated
server-side on a valid session **and** the `ADMIN` role — the React route guard
is convenience only. See [Admin](#admin) below.

### 4. Sitemap

```bash
npm run sitemap
```

Reads the live catalogue if the API is up and writes `public/sitemap.xml`;
falls back to static routes only if it isn't.

### 5. Hero media

The home hero is a **scroll-scrubbed video**: the garment comes apart as you
scroll down and reassembles as you scroll back up, driven by `video.currentTime`
rather than playback. Nothing autoplays.

```bash
npm run hero:media
```

Put the master render at `assets/source/denimque-hero-dress.mp4` (gitignored)
and run that. It writes the four things the hero needs into `public/assets/`,
plus `src/data/hero-media.json`, which is generated — don't hand-edit it.

**A delivery MP4 cannot be scrubbed as-is, which is the whole reason this script
exists.** The render we were given is 25.75 MB, stores its `moov` atom *after*
`mdat` (so a browser must download the entire file before it can seek at all),
and carries 2 keyframes across 300 frames — every seek would replay up to 150
frames. The script re-encodes all-intra (`-g 1`) with `+faststart`, which makes
every frame a keyframe and puts the index first. Measured result: **median seek
5.2 ms, p90 12 ms** — inside a 60 fps frame budget — at **3.45 MB**.

It also trims the tail. The render's own arc is complete → exploded →
*reassembled by 10s*, but scroll progress 0→1 maps onto 0→5.9s (peak
separation) only. Scrolling back up replays that same segment in reverse, which
is what reassembles the garment — one timeline, both directions, no second
animation. Keeping the render's own reassembly footage would mean 100% scroll
showed a complete dress again.

| Output | Size | Purpose |
| --- | --- | --- |
| `videos/denimque-hero-dress.mp4` | 3.45 MB | desktop/tablet, 1280 wide |
| `videos/denimque-hero-dress-mobile.mp4` | 1.96 MB | phones, 1080 wide |
| `frames/frame-001..090.webp` | 1.59 MB | fallback if seeking proves unreliable |
| `images/denimque-hero-dress-poster.webp` | 0.05 MB | poster + `og:image` |

The frame sequence is a **runtime fallback, not the default**. `useScrollMedia`
tries the video first and only switches if the element errors or accepts
`currentTime` without ever firing `seeked` (old iOS). Frames then load
coarse-to-fine — every 6th first, the rest after 1.2 s — so the hero is
scrubbable for a few hundred KB.

To swap the campaign, edit `src/data/hero.ts`: copy, price, category, gallery,
CTA, the scroll→second beat table, and the per-breakpoint framing targets are
all there. If you swap the *render*, re-measure the garment's bounding box
(`SUBJECT` in `scripts/prepare-hero-media.mjs`) — the stage sizes the garment,
not the video frame, and that box is how it knows the difference. The comment
above `SUBJECT` has the ffmpeg one-liner that draws the measurement grid.

---

## Layout

```
src/
  assets/media.ts          all editorial image URLs — swap here for real assets
  data/
    hero.ts                hero campaign: copy, price, beats, framing targets
    hero-media.json        GENERATED by npm run hero:media — do not edit
  components/
    cart/                  cart drawer
    footer/  hero/         hero/ is the scroll-scrubbed deconstruction stage
    layout/
    navigation/            navbar, mobile menu, search overlay
    products/              product card, quick view, denim preview (SVG)
    storytelling/          the pinned scroll film
    ui/                    preloader, toast, magnetic button, reveal
  hooks/                   smooth scroll, scroll lock, reduced motion,
                           useScrollMedia (the video scrub engine)
  pages/                   Home Shop Product About Contact Cart Checkout
                           OrderSuccess Account Wishlist Customize NotFound
  services/api.ts          single typed API client
  store/                   cart, wishlist, auth, ui
  utils/format.ts          money + order totals (mirrors the server)
  utils/heroFraming.ts     solves stage geometry from the garment's bbox

server/
  prisma/                  schema.prisma, seed.ts
  src/
    config/                env validation, prisma client
    controllers/           products auth cart wishlist orders payments
                           users contact customization
    middleware/            auth, validate, error, rate limit
    routes/index.ts        the whole API surface in one file
    services/              pricing, email, settings, production
      payments/            provider registry, the four providers,
                           state machine, money, orchestration
    utils/                 HttpError, Decimal serialisation
```

---

## API

All routes are under `/api`. Money is returned as fixed-2 strings, never floats.

| Method | Route                     | Auth      |
| ------ | ------------------------- | --------- |
| GET    | `/health`                 | –         |
| GET    | `/products`               | –         |
| GET    | `/products/:slug`         | –         |
| GET    | `/categories`             | –         |
| GET    | `/search?q=`              | –         |
| POST   | `/auth/register`          | –         |
| POST   | `/auth/login`             | –         |
| POST   | `/auth/logout`            | –         |
| GET    | `/auth/me`                | required  |
| GET    | `/users/addresses`        | required  |
| POST   | `/users/addresses`        | required  |
| DELETE | `/users/addresses/:id`    | required  |
| PATCH  | `/users/me`               | required  |
| GET    | `/cart`                   | required  |
| POST   | `/cart`                   | required  |
| PATCH  | `/cart/:itemId`           | required  |
| DELETE | `/cart/:itemId`           | required  |
| GET    | `/wishlist`               | required  |
| POST   | `/wishlist`               | required  |
| DELETE | `/wishlist/:itemId`       | required  |
| POST   | `/orders`                 | optional  |
| GET    | `/orders`                 | required  |
| GET    | `/orders/:id`             | optional  |
| GET    | `/payments/methods`       | –         |
| POST   | `/payments/intent`        | optional  |
| POST   | `/payments/confirm`       | optional  |
| POST   | `/payments/webhooks/razorpay` | signature |
| POST   | `/payments/webhooks/phonepe`  | signature |
| POST   | `/payments/webhooks/stripe`   | signature |
| POST   | `/contact`                | –         |
| GET    | `/customization/options`  | –         |
| POST   | `/customization`          | optional  |

---

## Admin

The operational backend of the storefront, at `/admin`. Screens: dashboard,
orders, production, live carts, customers, products, categories, process
stages, settings.

### Authentication

`POST /api/admin/login` is deliberately separate from the storefront login: the
role is checked **before** a session is issued, so a customer posting there
never receives a cookie. Same bcrypt hashes, same httpOnly `SameSite=Lax`
cookie, no second credential store. Everything past `/api/admin/login` runs
`verifyOrigin → requireAuth → requireAdmin`.

| Method       | Route                                          |
| ------------ | ---------------------------------------------- |
| POST         | `/admin/login`                                 |
| GET/POST     | `/admin/me`, `/admin/logout`                   |
| GET          | `/admin/dashboard`                             |
| CRUD         | `/admin/categories`, `/admin/products`         |
| CRUD         | `/admin/processes` (stage library)             |
| CRUD         | `/admin/products/:id/processes` (per-product)  |
| GET/PATCH    | `/admin/customers`, `/admin/orders`            |
| GET          | `/admin/carts`, `/admin/carts/summary`         |
| GET/PATCH    | `/admin/production`, `/admin/production/:id`   |
| POST         | `/admin/production/:id/start`, `/rebuild`      |
| PATCH        | `/admin/production/:id/stages/:stageId`        |
| GET/PATCH    | `/admin/settings`                              |
| GET          | `/admin/activity`, `/admin/export?type=`       |

### Dynamic categories

The shop route is `/shop/:categorySlug` and resolves against the database, so a
category created in admin makes its URL work immediately with no code change.
Disabling one removes it from navigation and its listing returns empty rather
than falling back to the whole catalogue. `/shop/limited-editions` remains
backed by the `isLimited` flag, unioned with anything explicitly filed under
that category, so the original behaviour is preserved.

### Production planning

A product's process stages (`ProductProcess`) carry optional per-product
duration and cost overrides; a null override inherits the stage default, so
editing the stage library updates every product that hasn't opted out. Rows are
stored individually — never rolled into a single total — so admin can see where
time and cost actually sit.

When an order is placed, `createProductionPlans` runs **inside the order
transaction**: an order can never exist without the work it implies. Estimates
are snapshotted onto the plan, so later catalogue edits never rewrite a live
plan's deadline. Deadlines are computed from the configured working days and
minutes-per-day in admin settings.

Completing a stage records `completedAt`, derives `actualMinutes` from when it
started, activates the next stage, and rolls the order status forward
(`IN_PRODUCTION`, then `READY` when every stage is settled) — never backwards
from `SHIPPED`/`DELIVERED`, and never over a cancellation.

Overdue is derived, not stored: a plan past its deadline that is neither
completed nor cancelled. Completed work is never retroactively overdue.

### Cart activity

`/admin/carts` reads the same persisted server cart the storefront writes to,
so a signed-in customer's add-to-cart is visible to admin. Status is derived —
`ACTIVE` (touched recently), `ABANDONED` (idle past the configured window),
`CONVERTED` (emptied at checkout, customer has orders). There is no websocket
layer in this stack, so the admin views revalidate on an interval (30s carts,
60s dashboard and production). This is polling and is labelled as such.

### Revenue

Counted only from orders whose payment reached `CAPTURED` or
`PARTIALLY_REFUNDED` — never `PENDING`, `AUTHORIZED` or `FAILED`, and never a
fully `REFUNDED` one. It is a query over payment status, not a running total, so
a duplicate webhook cannot inflate it. With the default `manual` provider and no
admin having settled anything, these figures are legitimately zero rather than
invented.

### Things worth knowing

**Prices are never trusted from the client.** `POST /orders` re-reads every
product from the database, recomputes subtotal, shipping and tax
(`server/src/services/pricing.ts`), decrements inventory, and snapshots the
name, image and unit price onto the order line — so historical orders don't
change when the catalogue does. It all runs in one transaction.

**No order is ever marked paid without provider verification.**
`/payments/intent` opens a charge with the chosen provider and stores its
handles. Nothing is settled until either the provider's signed webhook arrives
or `/payments/confirm` re-reads the payment from the provider's own API. A
browser saying "it worked" is never sufficient, and the amount is always
re-derived from the order row. See [Payments](#payments-1).

**Guest vs. signed-in carts.** Guests keep their cart in `localStorage`
(Zustand `persist`). Signed-in users get the same local cart mirrored to the
server, and `sync()` reconciles from the server on sign-in. A signed-in add
adopts the row id the API assigns, so later quantity changes address the real
`CartItem` — that mirroring is what the admin cart board reads. `localStorage`
is a guest-UX cache only; the server cart is the source of truth for anything
the business acts on.

**Linting is not configured.** There is no ESLint config in the repository, so
`npm run lint` fails with "eslint not found". `npm run typecheck` and
`npm --prefix server run typecheck` are the type-level gates that do run.

---

## Deploying to production

### Environment

Names only — never commit values. The API refuses to boot with `NODE_ENV=production`
until the required ones are set and sane.

**Frontend** (build-time, baked into the bundle — put nothing secret here):

| Variable | Required | Notes |
| --- | --- | --- |
| `VITE_API_URL` | yes, unless same-origin | Origin of the deployed API, e.g. `https://api.example.com`. Unset means `/api` on the page's own origin. |

**API:**

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production` |
| `PORT` | no | Defaults to 4000 |
| `DATABASE_URL` | yes | Managed Postgres connection string |
| `JWT_SECRET` | yes | 32+ characters; the `.env.example` placeholder is rejected |
| `JWT_EXPIRES_IN` | no | Defaults to `7d` |
| `CORS_ORIGIN` | yes | Comma-separated storefront origins. No default in production |
| `COOKIE_DOMAIN` | if cross-subdomain | e.g. `.example.com` |
| `COOKIE_SAMESITE` | no | `lax` (default), `strict`, or `none`. `none` also requires HTTPS and `COOKIE_DOMAIN` |
| `BUSINESS_TIMEZONE` | no | IANA zone, defaults to `Asia/Kolkata` |
| `PAYMENT_PROVIDER` | no | `auto` (default), or `manual` / `razorpay` / `phonepe` / `stripe`, or a comma list |
| `PAYMENT_MODE` | no | `test` or `live`. Defaults to `live` in production, `test` otherwise |
| `PAYMENT_RETURN_ORIGIN` | if API and storefront differ | Origin gateways redirect back to; also the base for webhook URLs |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | if Razorpay | All three. Secret + webhook secret never leave the server |
| `PHONEPE_API_VERSION` | if PhonePe | `v2` (default) or `v1` |
| `PHONEPE_BASE_URL`, `PHONEPE_AUTH_BASE_URL` | if PhonePe live | Required in live mode; sandbox defaults apply in test mode |
| `PHONEPE_CLIENT_ID`, `PHONEPE_CLIENT_SECRET`, `PHONEPE_CLIENT_VERSION` | if PhonePe v2 | Server-side only |
| `PHONEPE_CALLBACK_USERNAME`, `PHONEPE_CALLBACK_PASSWORD` | if PhonePe v2 | Callback authentication pair |
| `PHONEPE_MERCHANT_ID`, `PHONEPE_SALT_KEY`, `PHONEPE_SALT_INDEX` | if PhonePe v1 | Server-side only |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | if Stripe | Server-side only |
| `STRIPE_PUBLISHABLE_KEY` | if Stripe | Sent to the browser by design |
| `EMAIL_PROVIDER` | no | `log` (default), `resend` or `smtp` |
| `RESEND_API_KEY` | if Resend | |
| `EMAIL_FROM`, `CONTACT_INBOX` | no | |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | seed only | Read by `npm run seed`, never by the running API |

`ADMIN_PASSWORD` only ever sets the password of an admin that does not exist
yet, or rotates it when explicitly provided. It is never returned by any API
response and never logged.

### Cookies

The session is an httpOnly, `Secure` (in production), `SameSite=Lax` cookie on
path `/`, expiring in 7 days. Because it is `Lax`, the API and the storefront
must be **same-site** — `example.com` and `api.example.com` with
`COOKIE_DOMAIN=.example.com` works. Hosting the API on an unrelated domain
requires `COOKIE_SAMESITE=none` over HTTPS.

Logout clears the cookie. Tokens are stateless, so a token already issued stays
valid until it expires; admin authority is re-checked against the database on
every `/api/admin/*` request, so demoting or suspending an admin takes effect on
their next request.

### Timezone

Every server-side day boundary — dashboard "today", due-today/due-tomorrow
windows, overdue evaluation, `completedToday` — is derived from
`BUSINESS_TIMEZONE`, not from the server's clock zone or the browser's. Set it
once and the numbers are the same wherever the container runs. Timestamps go
over the wire as UTC ISO strings; the admin UI formats them for display.

### Migrations

```bash
npm --prefix server run prisma:deploy
```

`prisma migrate deploy` applies pending migrations and never resets, drops or
re-baselines. Do **not** run `prisma migrate dev` or `migrate reset` against
production. The current migrations are additive (tables, then indexes); the
index migration takes a brief lock per table as each index builds.

Back the database up before migrating — `prisma migrate deploy` has no undo.

### Deployment sequence

```bash
npm ci && npm --prefix server ci
npm --prefix server run build
npm run build
npm --prefix server run prisma:deploy
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' npm --prefix server run seed
npm --prefix server start
```

Serve `dist/` as static files. Point a health check at `GET /api/health`, which
returns `{"status":"ok","database":"ok"}` and nothing else — no connection
string, no version, no environment detail — and 503 when the database is
unreachable.

### Payments

Four gateways are supported. All four go through one provider registry, so
buying a gateway later means supplying its credentials — not editing checkout,
orders, admin or the webhook plumbing.

```
PaymentService              server/src/services/payments/service.ts
      ↓
Provider registry           server/src/services/payments/registry.ts
      ├── Manual            no credentials; reconciled off-platform
      ├── Razorpay          REST + HMAC signature + signed webhook
      ├── PhonePe           REST (v1 salt / v2 OAuth) + verified callback
      └── Stripe            REST + Checkout Session + signed webhook
```

| Gateway | Implemented | Refunds | Webhook | Ready when |
| --- | --- | --- | --- | --- |
| Manual | yes | recorded | n/a | always |
| Razorpay | yes | yes | yes | `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` + `RAZORPAY_WEBHOOK_SECRET` set |
| PhonePe | yes | yes | yes | v2: client id/secret/version + callback pair · v1: merchant id + salt key/index |
| Stripe | yes | yes | yes | `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` set |

**No gateway has been exercised against live credentials.** The signature,
checksum, state-machine, amount and idempotency logic is covered by
deterministic fixtures in `server/scripts/verify.mjs`; the request/response
shapes follow each provider's documented REST API. Run one sandbox transaction
per gateway before taking real money — see *Verifying a gateway* below.

#### Choosing providers

`PAYMENT_PROVIDER` decides what *may* be offered; credentials decide what
actually is. A provider appears in checkout only when it is both.

| Value | Behaviour |
| --- | --- |
| `auto` (default) | Every gateway whose credentials are complete is offered. Falls back to `manual` when none are. |
| `manual` | Bank transfer / pay on delivery only. |
| `razorpay` | Razorpay only. Missing credentials ⇒ unavailable, not a fake success. |
| `razorpay,stripe` | Both, in that order. The first is the storefront's default selection. |

`GET /api/payments/methods` returns exactly what the storefront may show —
provider ids, labels, and publishable values only. A gateway that is selected
but misconfigured returns `503` from `/payments/intent` with a clear message,
and the boot log says which variable is missing. It never crashes the API and
never produces a `PAID` order.

#### 1 · Running with manual payment

Nothing to configure. `PAYMENT_PROVIDER=manual` (or leaving `auto` with no
gateway credentials) reserves the order as `PENDING` with a `PENDING` payment,
and an admin settles it from the order detail page once the money arrives. The
manual provider has no self-confirming path: `verifyPayment` reports `PENDING`,
so a customer cannot advance it.

#### 2 · Activating Razorpay

1. Dashboard → *Account & Settings → API Keys* → generate a key pair.
2. Dashboard → *Settings → Webhooks* → add
   `https://<api-host>/api/payments/webhooks/razorpay`, choose a secret, and
   subscribe to `payment.captured`, `payment.authorized`, `payment.failed` and
   `refund.processed`.
3. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`.
4. Set `PAYMENT_PROVIDER=razorpay` (or leave `auto`).

The webhook secret is **not** optional: without it a callback cannot be
authenticated, and the provider stays unavailable rather than trusting an
unsigned one. Test keys are `rzp_test_…`, live keys `rzp_live_…`, and a key that
disagrees with `PAYMENT_MODE` is treated as misconfigured.

#### 3 · Activating PhonePe

PhonePe onboards each merchant onto one API generation, and issues host names
per merchant. Set the version your merchant pack documents — do not guess.

*v2 — PG Standard Checkout (default):*

```
PHONEPE_API_VERSION=v2
PHONEPE_CLIENT_ID=…
PHONEPE_CLIENT_SECRET=…
PHONEPE_CLIENT_VERSION=…
PHONEPE_CALLBACK_USERNAME=…
PHONEPE_CALLBACK_PASSWORD=…
PHONEPE_BASE_URL=…          # required in live mode
PHONEPE_AUTH_BASE_URL=…     # required in live mode
```

*v1 — legacy salt-key PG:*

```
PHONEPE_API_VERSION=v1
PHONEPE_MERCHANT_ID=…
PHONEPE_SALT_KEY=…
PHONEPE_SALT_INDEX=…
PHONEPE_BASE_URL=…          # required in live mode
```

Configure the callback URL `https://<api-host>/api/payments/webhooks/phonepe` on
the PhonePe dashboard. For v2, the callback username/password pair is also
configured there — PhonePe sends `SHA256("username:password")` as the
`Authorization` header and the server compares it in constant time.

In live mode `PHONEPE_BASE_URL` is required, deliberately: defaulting it would
risk pointing production at the sandbox.

#### 4 · Activating Stripe

1. Dashboard → *Developers → API keys* → copy the secret and publishable keys.
2. Dashboard → *Developers → Webhooks* → add
   `https://<api-host>/api/payments/webhooks/stripe`, and subscribe to
   `checkout.session.completed`, `checkout.session.expired`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `payment_intent.payment_failed`
   and `charge.refunded`.
3. Set `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PUBLISHABLE_KEY`.
4. Set `PAYMENT_PROVIDER=stripe` (or leave `auto`).

Only the publishable key reaches the browser. Returning to `success_url` proves
nothing: the confirmation page triggers a server-side session read, and the
webhook is authoritative.

#### Test and live mode

`PAYMENT_MODE` is `live` under `NODE_ENV=production` and `test` otherwise, and
can be set explicitly. A key whose prefix contradicts the mode (`sk_live_` in
test, `rzp_test_` in live) makes the provider unavailable rather than being
used, and Stripe's secret and publishable keys must be from the same mode. Use
each gateway's sandbox credentials for `test`.

#### Webhook URLs

```
https://<api-host>/api/payments/webhooks/razorpay
https://<api-host>/api/payments/webhooks/phonepe
https://<api-host>/api/payments/webhooks/stripe
```

These are mounted ahead of the JSON body parser and the origin allowlist,
because signatures are computed over the exact bytes delivered and a gateway
can send neither a CSRF token nor an allowlisted `Origin`. Authenticity comes
from cryptography instead: every handler verifies the provider's signature
before reading a single field. The CSRF posture of every other route is
unchanged. `200` means verified (including "already applied"), `400` a failed
signature, `503` a provider not configured here, `500` our fault — and a `500`
is safe to retry, because each outcome is applied in one transaction with its
idempotency claim.

Locally, tunnel them: `stripe listen --forward-to localhost:4000/api/payments/webhooks/stripe`,
or an ngrok URL for Razorpay/PhonePe.

#### Verifying a gateway is active

1. **Boot log** — the API prints
   `[payments] mode=test available=razorpay` on start, and a line naming each
   missing variable for any selected-but-unconfigured provider.
2. **API** — `curl https://<api-host>/api/payments/methods` lists exactly what
   checkout will offer.
3. **Admin** — *Settings → Payment gateways* shows every provider's state, the
   reason any is unavailable, and its webhook URL. It shows no secrets, and
   there is no endpoint that writes them.
4. **Checkout** — the payment step lists the enabled providers as radio
   options, and labels test mode explicitly.
5. **One sandbox transaction** — pay it, then confirm on the order that the
   payment reached `CAPTURED`, `paidAt` is set, and *Settings → Payment
   gateways → Recent provider events* shows the webhook as `applied`. Replay
   the same webhook from the provider's dashboard: the second delivery must
   record as `duplicate` and change nothing.

#### Payment state machine

Payment status and order status stay separate concepts.

```
PENDING     → AUTHORIZED | CAPTURED | FAILED
AUTHORIZED  → CAPTURED | FAILED
CAPTURED    → PARTIALLY_REFUNDED | REFUNDED
FAILED      → PENDING            (a new attempt reopens the row)
PARTIALLY_REFUNDED → REFUNDED
REFUNDED    → terminal
```

`FAILED → CAPTURED` is absent by construction: a failed payment can only reach
`CAPTURED` by going through `PENDING` again, which only `/payments/intent` does,
and which mints a fresh merchant reference. `AUTHORIZED` is the "processing"
state — the gateway holds the funds but has not captured.

A capture advances the *order* from `PENDING`/`CONFIRMED` to `PAID` and leaves
anything further along the fulfilment chain alone, so a late webhook cannot
rewind a shipped order. A full refund moves the order to `REFUNDED`; a partial
one does not, because the goods may still be owed.

Admins go through the same machine. An admin can settle or fail a *manual*
payment (audit-logged), but cannot hand-capture a gateway payment — that is the
gateway's job, and doing it by hand would put the books out of step with the
processor.

#### Idempotency and concurrency

Every provider callback claims a row in `PaymentEvent` (`@@unique([provider,
eventId])`) inside the same transaction that applies it. A replayed or
concurrent redelivery loses the unique constraint and applies nothing; a
delivery that fails mid-flight leaves no row, so the provider's retry still
works. Event ids are the provider's own where one exists (`x-razorpay-event-id`,
Stripe's `evt_…`) and a digest of order + state + transaction for PhonePe, which
sends none.

On top of that, the status write is conditional on the status that was read, so
two callbacks racing each other cannot both capture. `Payment.reference` and
`(provider, providerPaymentId)` are unique, so one gateway payment can settle at
most one order.

Stock, production plans and revenue need no protection here by construction:
stock is reserved and plans are built when the order is created, and revenue is
a query over settled payments rather than a running total. There is no counter
for a duplicate webhook to increment.

#### What is not stored

No card numbers, CVVs, banking credentials or provider secrets. `rawPayload`
holds only the status fields the code reads back from each provider. Secrets are
server-side environment variables and are never returned by any endpoint, in any
role, or written to the log.

Capture is already idempotent: a repeated callback returns the existing order
rather than re-capturing, and a cancelled or refunded order cannot become `PAID`.

### Verification

```bash
npm --prefix server run build
VERIFY_ADMIN_PASSWORD='...' npm --prefix server run verify
```

Starts the compiled API against `DATABASE_URL` and runs the end-to-end chain
plus the authorization, ownership, validation, money and concurrency checks.
It writes real rows — point it at a development database, never production.

---

## Accessibility & performance

- `prefers-reduced-motion` is honoured throughout: Lenis doesn't mount, GSAP
  timelines don't build, and the preloader is skipped.
- Skip link, focus-visible outlines, `aria-pressed` on size and wishlist
  toggles, labelled icon buttons, Escape closes every overlay.
- Route-level code splitting; only the home page is in the initial bundle.
- Images are `loading="lazy"` with a background colour to avoid layout shift.
- Animation is transform/opacity only — no animated layout properties.

---

## Verified / not verified

Verified locally:

- `npm run build` — clean, code-split as intended.
- `npm run typecheck` (frontend) and `npm run typecheck` in `server/` — no errors.
- API boots from both `tsx` and the compiled `dist/`; checked `/api/health`,
  `/api/customization/options`, the 404 shape, validation errors, and the auth
  guard on `/api/cart`.
- In a browser: every route renders (home, shop, product, about, contact, cart,
  wishlist, customise, account, 404), repeated navigation in and out of the
  pinned home page leaves no stray DOM, no console errors beyond the expected
  API-proxy failures, and no horizontal overflow at 375px on any page.
- Cart: persisted rehydration recomputes totals, the badge count tracks
  quantity, the drawer scroll-locks the page, and Escape closes it.

Verified for the scroll-scrubbed hero specifically:

- Beat mapping, in the browser at 1440x900: scroll 0/20/45/70/85% put the video
  at 0.000 / 1.992 / 3.397 / 4.592 / 5.895s, and 85→100% holds at 5.895s.
- Reverse scroll retraces the same timeline — max divergence 13 ms across the
  five checkpoints, under half a frame, and that residue is the easing lerp.
- Seek cost over 40 seeks: median 5.2 ms, p90 12.0 ms, max 15.1 ms.
- Geometry, numerically, across 8 viewports (1920x1080 → 360x640): the garment
  lands at 71.8% of viewport height on desktop and 65-68% on phones, is centred
  to within 0.03% (the render is off-centre; the stage pans to correct it), and
  the exploded silhouette never exceeds its width budget or touches the copy.
- Route changes in and out of the hero leave no stray DOM and don't crash.
- Mobile serves the 1.96 MB encode, desktop the 3.45 MB one.
- The frame-sequence fallback, by pointing the video at a missing file: the
  element errors, the video hides, the canvas takes over, and it scrubs —
  distinct pixel signatures at 0/30/60/85%, and returning to 0% reproduces the
  first frame's signature exactly.

Not verified:

- Real iOS/Safari. The fallback path works when triggered by a load error
  (above), but the case it actually exists for — Safari accepting `currentTime`
  and never decoding, caught by the 2.5 s watchdog — has not been seen on a
  real device.
- Real touch-device scrubbing performance (tested with synthetic scroll only).
- `npm run lint` — the script references `eslint`, which is not in
  `devDependencies`, so it cannot run. Pre-existing; unrelated to this work.

Two bugs were found and fixed during that pass, both worth knowing about if you
extend the motion work:

1. Navigating away from the home page crashed the tree with
   `removeChild: node is not a child of this node`. ScrollTrigger's `pin`
   reparents the section into a generated `pin-spacer`, and a passive
   `useEffect` cleanup runs too late to undo it. All GSAP setup now uses
   `useLayoutEffect` so the context reverts before React removes the nodes.
2. The hero's GSAP entrance timeline could stall part-way and leave the CTA at
   `opacity: 0`. The entrance is now a CSS animation (`animate-hero-in`), which
   always reaches its end state; GSAP is reserved for scroll-linked motion.

An `ErrorBoundary` now wraps the routed content, so a future component fault
degrades one page instead of blanking the site.

**Not verified:** anything that needs PostgreSQL. No database was available in
the environment this was built in, so `prisma migrate`, the seed, and every
DB-backed endpoint (products, orders, auth, cart) are written but unexecuted.
Run steps 2–3 above to confirm them.

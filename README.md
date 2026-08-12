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
| Payments  | Provider abstraction (manual / Razorpay / Stripe) |
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

The seed creates 4 categories, 6 products (with images, sizes and stock levels
that include deliberate sold-out sizes), a coupon, and a demo account:

```
demo@denimque.com / denimque2026
```

### 4. Sitemap

```bash
npm run sitemap
```

Reads the live catalogue if the API is up and writes `public/sitemap.xml`;
falls back to static routes only if it isn't.

---

## Layout

```
src/
  assets/media.ts          all editorial image URLs — swap here for real assets
  components/
    cart/                  cart drawer
    footer/  hero/  layout/
    navigation/            navbar, mobile menu, search overlay
    products/              product card, quick view, denim preview (SVG)
    storytelling/          the pinned scroll film
    ui/                    preloader, toast, magnetic button, reveal
  hooks/                   smooth scroll, scroll lock, reduced motion
  pages/                   Home Shop Product About Contact Cart Checkout
                           OrderSuccess Account Wishlist Customize NotFound
  services/api.ts          single typed API client
  store/                   cart, wishlist, auth, ui
  utils/format.ts          money + order totals (mirrors the server)

server/
  prisma/                  schema.prisma, seed.ts
  src/
    config/                env validation, prisma client
    controllers/           products auth cart wishlist orders payments
                           users contact customization
    middleware/            auth, validate, error, rate limit
    routes/index.ts        the whole API surface in one file
    services/              pricing, payment providers, email
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
| POST   | `/payments/intent`        | optional  |
| POST   | `/payments/confirm`       | –         |
| POST   | `/contact`                | –         |
| GET    | `/customization/options`  | –         |
| POST   | `/customization`          | optional  |

### Things worth knowing

**Prices are never trusted from the client.** `POST /orders` re-reads every
product from the database, recomputes subtotal, shipping and tax
(`server/src/services/pricing.ts`), decrements inventory, and snapshots the
name, image and unit price onto the order line — so historical orders don't
change when the catalogue does. It all runs in one transaction.

**No order is ever marked paid without provider verification.**
`/payments/intent` opens a charge and stores the reference. `/payments/confirm`
calls `provider.verify()` and only advances the order to `PAID` if that returns
true. The `manual` provider's `verify()` returns `false` by design: those orders
stay `PENDING` until settled off-platform. Razorpay and Stripe are wired into
the same interface but their two calls throw `501` until implemented — the
places to fill in are marked in `server/src/services/payment.ts`.

**Guest vs. signed-in carts.** Guests keep their cart in `localStorage`
(Zustand `persist`). Signed-in users get the same local cart mirrored to the
server, and `sync()` reconciles from the server on sign-in.

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

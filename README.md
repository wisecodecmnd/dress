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

#!/usr/bin/env node
/**
 * Writes public/sitemap.xml from the live catalogue.
 *
 * Static routes are always included. Product URLs are pulled from the API when
 * it's reachable, so a build without a running API still produces a valid
 * sitemap for the marketing pages instead of failing.
 *
 *   node scripts/generate-sitemap.mjs
 *   SITE_URL=https://denimque.com API_URL=https://api.denimque.com node scripts/generate-sitemap.mjs
 */
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SITE_URL = (process.env.SITE_URL ?? 'https://denimque.com').replace(/\/$/, '');
const API_URL = (process.env.API_URL ?? 'http://localhost:4000').replace(/\/$/, '');

const staticRoutes = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/shop', priority: '0.9', changefreq: 'daily' },
  { path: '/shop/jeans', priority: '0.8', changefreq: 'daily' },
  { path: '/shop/jackets', priority: '0.8', changefreq: 'daily' },
  { path: '/shop/shirts', priority: '0.8', changefreq: 'daily' },
  { path: '/shop/overshirts', priority: '0.8', changefreq: 'daily' },
  { path: '/shop/limited-editions', priority: '0.8', changefreq: 'daily' },
  { path: '/customize', priority: '0.7', changefreq: 'monthly' },
  { path: '/about', priority: '0.6', changefreq: 'monthly' },
  { path: '/contact', priority: '0.6', changefreq: 'monthly' },
];

async function fetchProducts() {
  try {
    const res = await fetch(`${API_URL}/api/products?limit=60`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`API responded ${res.status}`);
    const { products = [] } = await res.json();
    return products;
  } catch (err) {
    console.warn(`[sitemap] catalogue unavailable (${err.message}) — writing static routes only`);
    return [];
  }
}

const escape = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const urlEntry = ({ loc, lastmod, changefreq, priority }) =>
  [
    '  <url>',
    `    <loc>${escape(loc)}</loc>`,
    lastmod ? `    <lastmod>${lastmod.slice(0, 10)}</lastmod>` : null,
    changefreq ? `    <changefreq>${changefreq}</changefreq>` : null,
    priority ? `    <priority>${priority}</priority>` : null,
    '  </url>',
  ]
    .filter(Boolean)
    .join('\n');

const products = await fetchProducts();

const body = [
  ...staticRoutes.map((r) =>
    urlEntry({ loc: `${SITE_URL}${r.path}`, changefreq: r.changefreq, priority: r.priority }),
  ),
  ...products.map((p) =>
    urlEntry({
      loc: `${SITE_URL}/product/${p.slug}`,
      lastmod: p.updatedAt ?? p.createdAt,
      changefreq: 'weekly',
      priority: '0.7',
    }),
  ),
].join('\n');

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sitemap.xml');
await writeFile(out, xml, 'utf8');

console.info(
  `[sitemap] wrote ${staticRoutes.length + products.length} urls to public/sitemap.xml`,
);

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../services/api';

// Editorial columns are authored copy, not catalogue data, so they stay here.
const editorialColumns = [
  {
    title: 'Maison',
    links: [
      { label: 'Heritage', to: '/about' },
      { label: 'The Atelier', to: '/about' },
      { label: 'Editions', to: '/shop/limited-editions' },
      { label: 'Make Your Denim', to: '/customize' },
    ],
  },
  {
    title: 'Care',
    links: [
      { label: 'Shipping', to: '/contact' },
      { label: 'Returns', to: '/contact' },
      { label: 'Contact', to: '/contact' },
      { label: 'Account', to: '/account' },
    ],
  },
];

/** Fallback until the live category list loads. */
const FALLBACK_SHOP_LINKS = [{ label: 'All pieces', to: '/shop' }];

export default function Footer() {
  const [shopLinks, setShopLinks] = useState(FALLBACK_SHOP_LINKS);

  // The Shop column mirrors whatever categories admin has left visible.
  useEffect(() => {
    let cancelled = false;

    api
      .getCategories()
      .then((res) => {
        if (cancelled || res.categories.length === 0) return;
        setShopLinks(
          res.categories.slice(0, 6).map((c) => ({ label: c.name, to: `/shop/${c.slug}` })),
        );
      })
      .catch(() => {
        // Keep the fallback link — the footer must always render.
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const columns = [...editorialColumns, { title: 'Shop', links: shopLinks }];

  return (
    <footer className="border-t border-stone/30 bg-obsidian px-6 pb-10 pt-20 lg:px-12">
      <div className="mx-auto max-w-[110rem]">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_2fr]">
          <div>
            <p className="font-display text-5xl tracking-[0.12em] text-pearl lg:text-7xl">
              DENIMQUE
            </p>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-fog">
              Selvedge denim, cut and finished by a single artisan. Built for those who refuse
              ordinary.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            {columns.map((col) => (
              <div key={col.title}>
                <span className="mb-4 block text-meta uppercase text-fog">{col.title}</span>
                <ul className="space-y-2">
                  {col.links.map((l) => (
                    <li key={`${col.title}-${l.label}`}>
                      <Link
                        to={l.to}
                        className="text-sm text-mist transition-colors hover:text-pearl"
                      >
                        {l.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-3 border-t border-stone/30 pt-6 text-meta uppercase text-fog sm:flex-row sm:justify-between">
          <span>© {new Date().getFullYear()} Denimque. Denim, redefined.</span>
          <span>Biella · Kojima · Mumbai</span>
        </div>
      </div>
    </footer>
  );
}

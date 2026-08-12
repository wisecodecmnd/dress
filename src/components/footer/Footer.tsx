import { Link } from 'react-router-dom';

const columns = [
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
  {
    title: 'Shop',
    links: [
      { label: 'Jeans', to: '/shop/jeans' },
      { label: 'Jackets', to: '/shop/jackets' },
      { label: 'Shirts', to: '/shop/shirts' },
      { label: 'Overshirts', to: '/shop/overshirts' },
    ],
  },
];

export default function Footer() {
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

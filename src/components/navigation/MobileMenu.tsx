import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useScrollLock } from '../../hooks/useSmoothScroll';

interface MobileMenuProps {
  links: { to: string; label: string }[];
}

export default function MobileMenu({ links }: MobileMenuProps) {
  const isOpen = useUIStore((s) => s.isMenuOpen);
  const closeMenu = useUIStore((s) => s.closeMenu);
  const { pathname } = useLocation();

  useScrollLock(isOpen);

  // Close on route change and on Escape.
  useEffect(() => closeMenu(), [pathname, closeMenu]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeMenu();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, closeMenu]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] lg:hidden" role="dialog" aria-modal="true" aria-label="Menu">
      <div className="absolute inset-0 bg-obsidian" />
      <div className="absolute inset-0 grain" aria-hidden="true" />

      <div className="relative flex h-full flex-col px-6 py-6">
        <div className="flex items-center justify-between">
          <span className="font-display text-xl tracking-[0.28em]">DENIMQUE</span>
          <button onClick={closeMenu} aria-label="Close menu" className="text-mist">
            <X size={22} />
          </button>
        </div>

        <nav className="mt-16 flex flex-col gap-6" aria-label="Mobile">
          {links.map((l, i) => (
            <Link
              key={l.to}
              to={l.to}
              className="animate-fade-up font-display text-4xl text-pearl"
              style={{ animationDelay: `${i * 60}ms` }}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-4 border-t border-stone/30 pt-6 text-meta uppercase text-mist">
          <Link to="/account">Account</Link>
          <Link to="/wishlist">Wishlist</Link>
          <Link to="/customize">Make Your Denim</Link>
        </div>
      </div>
    </div>
  );
}

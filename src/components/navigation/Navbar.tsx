import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Heart, Menu, Search, ShoppingBag, User } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { useCartStore } from '../../store/cartStore';
import { useWishlistStore } from '../../store/wishlistStore';
import MobileMenu from './MobileMenu';

const links = [
  { to: '/shop', label: 'Shop' },
  { to: '/shop/limited-editions', label: 'Collection' },
  { to: '/about', label: 'About' },
  { to: '/contact', label: 'Contact' },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();
  const openCart = useUIStore((s) => s.openCart);
  const toggleMenu = useUIStore((s) => s.toggleMenu);
  const openSearch = useUIStore((s) => s.openSearch);
  const cartCount = useCartStore((s) => s.count);
  const wishlistCount = useWishlistStore((s) => s.items.length);

  // The home hero is full-bleed, so the bar starts transparent there only.
  const overHero = pathname === '/' && !scrolled;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <>
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ease-editorial ${
          overHero
            ? 'bg-transparent py-6'
            : 'border-b border-stone/30 bg-obsidian/85 py-4 backdrop-blur-md'
        }`}
      >
        <div className="mx-auto flex max-w-[110rem] items-center justify-between px-6 lg:px-12">
          <button
            onClick={toggleMenu}
            className="text-mist transition-colors hover:text-pearl lg:hidden"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>

          <Link
            to="/"
            className="font-display text-xl tracking-[0.28em] text-pearl lg:text-2xl"
            aria-label="DENIMQUE home"
          >
            DENIMQUE
          </Link>

          <nav className="hidden items-center gap-10 lg:flex" aria-label="Primary">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  `link-underline text-meta uppercase transition-colors ${
                    isActive ? 'text-pearl' : 'text-mist hover:text-pearl'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-5">
            <button
              onClick={openSearch}
              className="text-mist transition-colors hover:text-pearl"
              aria-label="Search"
            >
              <Search size={18} />
            </button>

            <Link
              to="/account"
              className="hidden text-mist transition-colors hover:text-pearl sm:block"
              aria-label="Account"
            >
              <User size={18} />
            </Link>

            <Link
              to="/wishlist"
              className="relative hidden text-mist transition-colors hover:text-pearl sm:block"
              aria-label={`Wishlist, ${wishlistCount} items`}
            >
              <Heart size={18} />
              {wishlistCount > 0 && (
                <span className="absolute -right-2 -top-2 text-[10px] text-denim">
                  {wishlistCount}
                </span>
              )}
            </Link>

            <button
              onClick={openCart}
              className="relative text-mist transition-colors hover:text-pearl"
              aria-label={`Cart, ${cartCount} items`}
            >
              <ShoppingBag size={18} />
              {cartCount > 0 && (
                <span className="absolute -right-2 -top-2 text-[10px] text-denim">{cartCount}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <MobileMenu links={links} />
    </>
  );
}

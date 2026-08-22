import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Boxes,
  ClipboardList,
  Factory,
  LayoutDashboard,
  ListOrdered,
  LogOut,
  Menu,
  Settings as SettingsIcon,
  ShoppingCart,
  Tags,
  Users,
  X,
} from 'lucide-react';
import { useAdminAuthStore } from '../../store/adminAuthStore';

/**
 * Admin chrome: a fixed sidebar on desktop, a drawer on mobile.
 *
 * Deliberately outside the storefront <Layout>: the admin must not inherit
 * Lenis smooth scrolling, the preloader or the marketing nav, all of which
 * fight a dense operational UI.
 */
const NAV = [
  { to: '/admin/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/admin/orders', label: 'Orders', icon: ListOrdered },
  { to: '/admin/production', label: 'Production', icon: Factory },
  { to: '/admin/carts', label: 'Live carts', icon: ShoppingCart },
  { to: '/admin/customers', label: 'Customers', icon: Users },
  { to: '/admin/products', label: 'Products', icon: Boxes },
  { to: '/admin/categories', label: 'Categories', icon: Tags },
  { to: '/admin/processes', label: 'Processes', icon: ClipboardList },
  { to: '/admin/settings', label: 'Settings', icon: SettingsIcon },
];

export default function AdminShell() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const user = useAdminAuthStore((s) => s.user);
  const logout = useAdminAuthStore((s) => s.logout);

  // Close the drawer whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className="min-h-screen bg-obsidian text-pearl">
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b border-stone/40 bg-charcoal px-4 py-3 lg:hidden">
        <button
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          className="rounded p-2 text-mist hover:bg-stone/30 hover:text-pearl"
        >
          <Menu size={20} />
        </button>
        <span className="font-display text-lg tracking-wide">DENIMQUE Admin</span>
        <button
          onClick={handleLogout}
          aria-label="Sign out"
          className="rounded p-2 text-mist hover:bg-stone/30 hover:text-pearl"
        >
          <LogOut size={18} />
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-obsidian/80"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <nav className="absolute left-0 top-0 h-full w-72 max-w-[85vw] overflow-y-auto border-r border-stone/40 bg-charcoal p-5">
            <div className="mb-6 flex items-center justify-between">
              <span className="font-display text-xl">DENIMQUE</span>
              <button
                onClick={() => setOpen(false)}
                aria-label="Close navigation"
                className="rounded p-2 text-mist hover:bg-stone/30"
              >
                <X size={18} />
              </button>
            </div>
            <NavLinks />
          </nav>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="fixed left-0 top-0 hidden h-full w-60 flex-col border-r border-stone/40 bg-charcoal p-5 lg:flex">
        <div className="mb-8">
          <span className="block font-display text-2xl leading-none">DENIMQUE</span>
          <span className="text-meta uppercase text-fog">Control Center</span>
        </div>

        <NavLinks />

        <div className="mt-auto border-t border-stone/40 pt-4">
          <p className="truncate text-xs text-fog" title={user?.email}>
            {user?.email}
          </p>
          <button
            onClick={handleLogout}
            className="mt-2 flex w-full items-center gap-2 rounded px-2 py-2 text-sm text-mist transition-colors hover:bg-stone/30 hover:text-pearl"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      <main className="lg:pl-60">
        <div className="mx-auto max-w-[100rem] px-4 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavLinks() {
  return (
    <nav className="flex flex-col gap-1">
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded px-3 py-2 text-sm transition-colors ${
              isActive
                ? 'bg-stone/40 text-pearl'
                : 'text-mist hover:bg-stone/25 hover:text-pearl'
            }`
          }
        >
          <Icon size={16} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

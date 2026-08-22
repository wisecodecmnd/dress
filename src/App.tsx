import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/layout/Layout';
import RequireAdmin from './admin/components/RequireAdmin';
import Preloader from './components/ui/Preloader';
import Home from './pages/Home';
import { useAuthStore } from './store/authStore';
import { useCartStore } from './store/cartStore';
import { useWishlistStore } from './store/wishlistStore';

// Home ships in the initial bundle; everything else is split.
const Shop = lazy(() => import('./pages/Shop'));
const Product = lazy(() => import('./pages/Product'));
const About = lazy(() => import('./pages/About'));
const Contact = lazy(() => import('./pages/Contact'));
const Cart = lazy(() => import('./pages/Cart'));
const Checkout = lazy(() => import('./pages/Checkout'));
const OrderSuccess = lazy(() => import('./pages/OrderSuccess'));
const Account = lazy(() => import('./pages/Account'));
const Wishlist = lazy(() => import('./pages/Wishlist'));
const Customize = lazy(() => import('./pages/Customize'));
const NotFound = lazy(() => import('./pages/NotFound'));

// Admin is a separate application surface: its own shell, no storefront chrome,
// and lazily loaded so a customer never downloads it.
const AdminLogin = lazy(() => import('./admin/pages/Login'));
const AdminShell = lazy(() => import('./admin/components/AdminShell'));
const AdminDashboard = lazy(() => import('./admin/pages/Dashboard'));
const AdminCategories = lazy(() => import('./admin/pages/Categories'));
const AdminProducts = lazy(() => import('./admin/pages/Products'));
const AdminProductEdit = lazy(() => import('./admin/pages/ProductEdit'));
const AdminProcesses = lazy(() => import('./admin/pages/Processes'));
const AdminCustomers = lazy(() => import('./admin/pages/Customers'));
const AdminCustomerDetail = lazy(() => import('./admin/pages/CustomerDetail'));
const AdminCarts = lazy(() => import('./admin/pages/Carts'));
const AdminOrders = lazy(() => import('./admin/pages/Orders'));
const AdminOrderDetail = lazy(() => import('./admin/pages/OrderDetail'));
const AdminProduction = lazy(() => import('./admin/pages/Production'));
const AdminSettings = lazy(() => import('./admin/pages/Settings'));

function RouteFallback() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <span className="text-meta uppercase text-fog">Loading</span>
    </div>
  );
}

export default function App() {
  const { pathname } = useLocation();
  // The admin panel opts out of the storefront preloader entirely.
  const isAdmin = pathname.startsWith('/admin');

  const [revealed, setRevealed] = useState(() => sessionStorage.getItem('dq.seen') === '1');
  const initAuth = useAuthStore((s) => s.init);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const syncCart = useCartStore((s) => s.sync);
  const fetchWishlist = useWishlistStore((s) => s.fetchWishlist);

  const handleRevealed = useCallback(() => {
    // Show the preloader once per session, not on every client-side revisit.
    sessionStorage.setItem('dq.seen', '1');
    setRevealed(true);
  }, []);

  // The admin panel has its own session probe, so the storefront's customer
  // auth, cart and wishlist fetches are skipped there.
  useEffect(() => {
    if (isAdmin) return;
    void initAuth();
  }, [initAuth, isAdmin]);

  useEffect(() => {
    if (isAdmin || !isAuthenticated) return;
    void syncCart();
    void fetchWishlist();
  }, [isAdmin, isAuthenticated, syncCart, fetchWishlist]);

  return (
    <>
      {!revealed && !isAdmin && <Preloader onComplete={handleRevealed} />}

      <Routes>
        {/* Admin — outside <Layout> so it inherits no storefront chrome. */}
        <Route
          path="admin/login"
          element={
            <Suspense fallback={<RouteFallback />}>
              <AdminLogin />
            </Suspense>
          }
        />
        <Route
          path="admin"
          element={
            <Suspense fallback={<RouteFallback />}>
              <RequireAdmin>
                <AdminShell />
              </RequireAdmin>
            </Suspense>
          }
        >
          <Route index element={<Navigate to="/admin/dashboard" replace />} />
          <Route
            path="dashboard"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminDashboard />
              </Suspense>
            }
          />
          <Route
            path="categories"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminCategories />
              </Suspense>
            }
          />
          <Route
            path="products"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminProducts />
              </Suspense>
            }
          />
          <Route
            path="products/:id"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminProductEdit />
              </Suspense>
            }
          />
          <Route
            path="processes"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminProcesses />
              </Suspense>
            }
          />
          <Route
            path="customers"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminCustomers />
              </Suspense>
            }
          />
          <Route
            path="customers/:id"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminCustomerDetail />
              </Suspense>
            }
          />
          <Route
            path="carts"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminCarts />
              </Suspense>
            }
          />
          <Route
            path="orders"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminOrders />
              </Suspense>
            }
          />
          <Route
            path="orders/:id"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminOrderDetail />
              </Suspense>
            }
          />
          <Route
            path="production"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminProduction />
              </Suspense>
            }
          />
          <Route
            path="settings"
            element={
              <Suspense fallback={<RouteFallback />}>
                <AdminSettings />
              </Suspense>
            }
          />
        </Route>

        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route
            path="shop"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Shop />
              </Suspense>
            }
          />
          <Route
            path="shop/:category"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Shop />
              </Suspense>
            }
          />
          <Route
            path="product/:slug"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Product />
              </Suspense>
            }
          />
          <Route
            path="about"
            element={
              <Suspense fallback={<RouteFallback />}>
                <About />
              </Suspense>
            }
          />
          <Route
            path="contact"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Contact />
              </Suspense>
            }
          />
          <Route
            path="cart"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Cart />
              </Suspense>
            }
          />
          <Route
            path="checkout"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Checkout />
              </Suspense>
            }
          />
          <Route
            path="order-success/:id"
            element={
              <Suspense fallback={<RouteFallback />}>
                <OrderSuccess />
              </Suspense>
            }
          />
          <Route
            path="account"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Account />
              </Suspense>
            }
          />
          <Route
            path="wishlist"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Wishlist />
              </Suspense>
            }
          />
          <Route
            path="customize"
            element={
              <Suspense fallback={<RouteFallback />}>
                <Customize />
              </Suspense>
            }
          />
          <Route
            path="*"
            element={
              <Suspense fallback={<RouteFallback />}>
                <NotFound />
              </Suspense>
            }
          />
        </Route>
      </Routes>
    </>
  );
}

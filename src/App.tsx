import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Route, Routes } from 'react-router-dom';
import Layout from './components/layout/Layout';
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

function RouteFallback() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <span className="text-meta uppercase text-fog">Loading</span>
    </div>
  );
}

export default function App() {
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

  useEffect(() => {
    void initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (!isAuthenticated) return;
    void syncCart();
    void fetchWishlist();
  }, [isAuthenticated, syncCart, fetchWishlist]);

  return (
    <>
      {!revealed && <Preloader onComplete={handleRevealed} />}

      <Routes>
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

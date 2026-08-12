import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Navbar from '../navigation/Navbar';
import SearchOverlay from '../navigation/SearchOverlay';
import Footer from '../footer/Footer';
import CartDrawer from '../cart/CartDrawer';
import ErrorBoundary from './ErrorBoundary';
import ToastStack from '../ui/Toast';
import { getLenis, useSmoothScroll } from '../../hooks/useSmoothScroll';

export default function Layout() {
  const { pathname } = useLocation();
  useSmoothScroll();

  // Reset scroll between routes and let ScrollTrigger re-measure the new page.
  useEffect(() => {
    getLenis()?.scrollTo(0, { immediate: true });
    window.scrollTo(0, 0);
    const id = window.requestAnimationFrame(() => ScrollTrigger.refresh());
    return () => window.cancelAnimationFrame(id);
  }, [pathname]);

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-6 focus:top-6 focus:z-[90] focus:bg-pearl focus:px-4 focus:py-2 focus:text-sm focus:text-obsidian"
      >
        Skip to content
      </a>

      <Navbar />

      <main id="main">
        {/* Keyed by route so a crash on one page doesn't stick after navigating */}
        <ErrorBoundary key={pathname}>
          <Outlet />
        </ErrorBoundary>
      </main>

      <Footer />
      <CartDrawer />
      <SearchOverlay />
      <ToastStack />
    </>
  );
}

import { useEffect } from 'react';
import Lenis from 'lenis';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { prefersReducedMotion } from './useReducedMotion';

gsap.registerPlugin(ScrollTrigger);

let lenis: Lenis | null = null;

export const getLenis = () => lenis;

/**
 * Mounts Lenis once for the app and drives it from GSAP's ticker so
 * ScrollTrigger and the smooth-scroll position never drift apart.
 */
export function useSmoothScroll() {
  useEffect(() => {
    if (prefersReducedMotion()) return;

    lenis = new Lenis({
      duration: 1.1,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      // Native momentum on touch feels better than emulated smoothing.
      syncTouch: false,
    });

    lenis.on('scroll', ScrollTrigger.update);

    const raf = (time: number) => lenis?.raf(time * 1000);
    gsap.ticker.add(raf);
    gsap.ticker.lagSmoothing(0);

    return () => {
      gsap.ticker.remove(raf);
      lenis?.destroy();
      lenis = null;
    };
  }, []);
}

/** Stops/starts Lenis while a modal or drawer owns the scroll. */
export function useScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    lenis?.stop();
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
      lenis?.start();
    };
  }, [locked]);
}

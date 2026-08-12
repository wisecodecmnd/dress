import { useLayoutEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';
import { prefersReducedMotion } from '../../hooks/useReducedMotion';

interface PreloaderProps {
  onComplete: () => void;
}

/**
 * DENIMQUE · LOADING 00–100%
 * Counts to 100 while the first paint settles, then wipes upward to reveal
 * the site. Skipped entirely for reduced-motion users.
 */
export default function Preloader({ onComplete }: PreloaderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const [pct, setPct] = useState(0);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) {
      onComplete();
      return;
    }

    const counter = { value: 0 };
    const tl = gsap.timeline({ onComplete });

    tl.to(counter, {
      value: 100,
      duration: 1.6,
      ease: 'power2.inOut',
      onUpdate: () => setPct(Math.round(counter.value)),
    })
      .to(fillRef.current, { scaleX: 1, duration: 1.6, ease: 'power2.inOut' }, 0)
      .to('.pre-line', { opacity: 0, y: -12, duration: 0.5, stagger: 0.05, ease: 'power2.in' })
      .to(
        rootRef.current,
        { yPercent: -100, duration: 1, ease: 'expo.inOut' },
        '-=0.15',
      );

    return () => {
      tl.kill();
    };
  }, [onComplete]);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-obsidian"
      role="status"
      aria-live="polite"
      aria-label="Loading DENIMQUE"
    >
      <div className="absolute inset-0 grain" aria-hidden="true" />

      <div className="pre-line font-display text-4xl tracking-[0.3em] text-pearl sm:text-6xl">
        DENIMQUE
      </div>

      <div className="pre-line mt-8 h-px w-48 overflow-hidden bg-stone/40 sm:w-64">
        <span
          ref={fillRef}
          className="block h-full w-full origin-left scale-x-0 bg-pearl"
          aria-hidden="true"
        />
      </div>

      <div className="pre-line mt-5 flex items-baseline gap-2 text-meta uppercase text-fog">
        <span>Loading</span>
        <span className="tabular-nums text-mist">{String(pct).padStart(2, '0')}</span>
        <span>%</span>
      </div>
    </div>
  );
}

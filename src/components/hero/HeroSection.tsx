import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ChevronDown } from 'lucide-react';
import { media } from '../../assets/media';
import { prefersReducedMotion } from '../../hooks/useReducedMotion';

gsap.registerPlugin(ScrollTrigger);

export default function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;

    // GSAP handles only the scroll-linked motion here. The entrance stagger is
    // CSS (animate-hero-in + inline delays) so the copy always ends up visible
    // even if the tab is backgrounded or the ticker is throttled mid-reveal.
    const ctx = gsap.context(() => {
      gsap.to('.hero-bg', {
        scale: 1.14,
        opacity: 0.55,
        ease: 'none',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top top',
          end: 'bottom top',
          scrub: 1,
        },
      });

      gsap.to(contentRef.current, {
        y: -90,
        opacity: 0,
        ease: 'none',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top top',
          end: '55% top',
          scrub: 1,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section ref={sectionRef} className="relative h-[100svh] overflow-hidden">
      <div
        className="hero-bg absolute inset-0 bg-cover bg-center will-change-transform"
        style={{ backgroundImage: `url(${media.heroPoster})` }}
        role="img"
        aria-label="A model wearing DENIMQUE selvedge denim, lit low and warm"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-obsidian/50 via-obsidian/25 to-obsidian" />
      <div className="absolute inset-0 vignette" aria-hidden="true" />
      <div className="absolute inset-0 grain" aria-hidden="true" />

      <div
        ref={contentRef}
        className="relative z-10 flex h-full flex-col items-center justify-center px-6 text-center"
      >
        <span
          className="mb-6 animate-hero-in text-meta uppercase text-mist"
          style={{ animationDelay: '150ms' }}
        >
          Est. 2018 · Biella
        </span>

        <h1
          className="max-w-4xl animate-hero-in font-display text-display-xl text-pearl"
          style={{ animationDelay: '300ms' }}
        >
          DENIM,
          <br />
          REDEFINED.
        </h1>

        <p
          className="mt-6 max-w-md animate-hero-in text-body-lg text-mist"
          style={{ animationDelay: '550ms' }}
        >
          Built for those who refuse ordinary.
        </p>

        <Link
          to="/shop"
          className="mt-10 animate-hero-in border border-pearl/40 px-10 py-4 text-sm uppercase tracking-[0.2em] text-pearl transition-colors duration-500 ease-editorial hover:bg-pearl hover:text-obsidian"
          style={{ animationDelay: '750ms' }}
        >
          Explore Collection
        </Link>

        <div
          className="absolute bottom-10 flex animate-hero-in flex-col items-center gap-2 text-fog"
          style={{ animationDelay: '1000ms' }}
        >
          <span className="text-meta uppercase">Scroll</span>
          <ChevronDown size={16} className="animate-bounce" />
        </div>
      </div>
    </section>
  );
}

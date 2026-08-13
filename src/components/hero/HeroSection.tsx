import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ChevronDown } from 'lucide-react';
import { heroBeats, heroFraming, heroMedia, heroPhases, heroProduct } from '../../data/hero';
import { buildRemap, useScrollMedia } from '../../hooks/useScrollMedia';
import { solveStageFrame } from '../../utils/heroFraming';
import { prefersReducedMotion } from '../../hooks/useReducedMotion';
import { formatPrice } from '../../utils/format';

gsap.registerPlugin(ScrollTrigger);

/**
 * Total height of the hero, in viewport units. The first 100 is the stage
 * itself; the rest is the scroll distance the visitor spends pinned on it.
 */
const HERO_HEIGHT_VH = 320;
/**
 * Share of that distance spent animating. The remainder is the hold: the
 * garment sits fully deconstructed for a beat before the hero releases, so the
 * next section arrives as a consequence of the deconstruction rather than
 * interrupting it.
 */
const ANIMATION_SHARE = 0.85;

/** Idle float — the garment breathes when nobody is scrolling. */
const FLOAT_Y = 9;
const FLOAT_X = 4;
const FLOAT_PERIOD = 9;
/** Float amplitude is damped to this while the visitor is actively scrolling. */
const FLOAT_WHILE_SCROLLING = 0.12;

/**
 * Thresholds match Tailwind's `md` and `lg` exactly, because they have to: the
 * copy switches from stacked-under to beside-the-garment at `lg`, and the
 * framing has to reserve the band for it at precisely the same width.
 */
const breakpointFraming = (width: number) =>
  width < 768 ? heroFraming.mobile : width < 1024 ? heroFraming.tablet : heroFraming.desktop;

/** Maps 0..1 progress onto [from, to]. */
const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

/** Eased 0..1 window, for fading UI in or out across a slice of the scroll. */
const ramp = (p: number, start: number, end: number) => {
  const t = (p - start) / (end - start);
  return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
};

export default function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const outroRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLSpanElement>(null);
  const phaseRef = useRef<HTMLSpanElement>(null);
  const cueRef = useRef<HTMLSpanElement>(null);

  // Read once: switching sources mid-life would re-download the video, and the
  // breakpoints that matter here (which file to fetch) don't change on resize.
  const [reduced] = useState(prefersReducedMotion);
  const [source] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
      ? heroMedia.video.mobile
      : heroMedia.video.desktop,
  );

  const remap = useMemo(() => buildRemap(heroBeats, heroMedia.duration), []);

  /** Solved on mount and on resize; read every frame, never re-rendered. */
  const frame = useRef(
    solveStageFrame({ width: 1440, height: 900 }, source.aspect, heroMedia.subject, heroFraming.desktop),
  );
  const floatAmp = useRef(1);
  const lastProgress = useRef(0);
  const idleSince = useRef(0);
  const onScreen = useRef(true);

  /**
   * Everything that moves per frame, written straight to the DOM. React never
   * re-renders during the scrub — the eased progress arrives from the same
   * ticker that drives the garment, so the camera cannot drift out of step.
   */
  const onFrame = useCallback((p: number) => {
    const stage = stageRef.current;
    // Once the hero has scrolled away there is nothing to animate, and the
    // idle float would otherwise keep a compositor layer busy for the whole
    // page. The observer below flips this back on when the hero returns.
    if (!stage || !onScreen.current) return;

    const moving = Math.abs(p - lastProgress.current) > 0.0002;
    lastProgress.current = p;
    const now = performance.now();
    if (moving) idleSince.current = now;

    // Ease the float in only once the scroll has settled, so the breathing
    // never fights a scrub in progress.
    const wanted = now - idleSince.current > 220 ? 1 : FLOAT_WHILE_SCROLLING;
    floatAmp.current += (wanted - floatAmp.current) * 0.03;

    const phase = (now / 1000 / FLOAT_PERIOD) * Math.PI * 2;
    const { pullback, panFrom, panTo, lift } = frame.current;
    const x = lerp(panFrom, panTo, p) + Math.sin(phase * 0.6) * FLOAT_X * floatAmp.current;
    const y = lift + Math.sin(phase) * FLOAT_Y * floatAmp.current;
    const scale = lerp(pullback, 1, p);

    stage.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) scale(${scale.toFixed(4)})`;

    if (introRef.current) introRef.current.style.opacity = String(1 - ramp(p, 0, 0.18));
    if (cueRef.current) cueRef.current.style.opacity = String(1 - ramp(p, 0, 0.08));
    if (outroRef.current) outroRef.current.style.opacity = String(ramp(p, 0.78, 0.96));
    if (railRef.current) railRef.current.style.transform = `scaleX(${Math.max(0.015, p)})`;
    if (phaseRef.current) {
      const active = heroPhases.reduce((best, cur) => (p >= cur.at ? cur : best), heroPhases[0]);
      if (phaseRef.current.textContent !== active.label) {
        phaseRef.current.textContent = active.label;
      }
    }
  }, []);

  const { videoRef, canvasRef, status, setProgress, snapProgress } = useScrollMedia({
    duration: heroMedia.duration,
    remap,
    frames: heroMedia.frames,
    onFrame,
  });

  /**
   * useLayoutEffect so the stage is sized before first paint — a frame of
   * wrongly-scaled video on a black background is very visible.
   */
  useLayoutEffect(() => {
    if (reduced) return;
    const stage = stageRef.current;
    const section = sectionRef.current;
    if (!stage || !section) return;

    const measure = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      frame.current = solveStageFrame(
        viewport,
        source.aspect,
        heroMedia.subject,
        breakpointFraming(viewport.width),
      );
      stage.style.width = `${frame.current.width}px`;
      stage.style.height = `${frame.current.height}px`;
    };

    measure();
    // Position the garment for wherever the page was restored to, with no
    // easing, so a reload mid-hero doesn't animate from zero.
    snapProgress(0);

    const trigger = ScrollTrigger.create({
      trigger: section,
      start: 'top top',
      end: 'bottom bottom',
      // The stage is `position: sticky`, not ScrollTrigger-pinned, on purpose:
      // pinning reparents the node into a generated spacer, which is what
      // StorySection has to guard against on unmount. Sticky needs no cleanup
      // and stays perfectly in step with Lenis.
      onUpdate: (self) => setProgress(Math.min(1, self.progress / ANIMATION_SHARE)),
      onRefresh: measure,
    });

    const observer = new IntersectionObserver(
      ([entry]) => {
        onScreen.current = entry.isIntersecting;
      },
      { rootMargin: '10%' },
    );
    observer.observe(section);

    return () => {
      trigger.kill();
      observer.disconnect();
    };
  }, [reduced, source.aspect, setProgress, snapProgress]);

  const price = formatPrice(heroProduct.price, heroProduct.currency);

  /* ------------------------------------------------------------------------
   * Reduced motion: the poster, the copy, one screen. No scrub, no pinning.
   * ---------------------------------------------------------------------- */
  if (reduced) {
    return (
      <section className="relative flex h-[100svh] flex-col items-center justify-center overflow-hidden bg-obsidian px-6 text-center">
        <img
          src={heroMedia.poster}
          alt={heroProduct.alt}
          className="absolute left-1/2 top-1/2 h-[72svh] w-auto max-w-none -translate-x-1/2 -translate-y-1/2"
        />
        <div className="absolute inset-0 hero-spotlight" aria-hidden="true" />
        <div className="relative z-10">
          <span className="mb-6 block text-meta uppercase text-mist">{heroProduct.kicker}</span>
          <h1 className="max-w-4xl whitespace-pre-line font-display text-display-xl text-pearl">
            {heroProduct.headline}
          </h1>
          <p className="mt-6 text-body-lg text-mist">{heroProduct.tagline}</p>
          <Link
            to={heroProduct.cta.to}
            className="mt-10 inline-block border border-pearl/40 px-10 py-4 text-sm uppercase tracking-[0.2em] text-pearl transition-colors duration-500 ease-editorial hover:bg-pearl hover:text-obsidian"
          >
            {heroProduct.cta.label}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section
      id="hero"
      ref={sectionRef}
      className="relative bg-obsidian"
      style={{ height: `${HERO_HEIGHT_VH}svh` }}
      aria-label={`${heroProduct.name} — scroll to deconstruct the garment`}
    >
      {/* The pinned scene. Sticky, so the hero releases on its own at the end. */}
      <div className="sticky top-0 flex h-[100svh] items-center justify-center overflow-hidden bg-obsidian">
        <div
          ref={stageRef}
          className="relative shrink-0 will-change-transform"
          style={{ transform: 'translate3d(0,0,0)' }}
        >
          <video
            ref={videoRef}
            className={`hero-visual block h-full w-full object-contain transition-opacity duration-700 ease-editorial ${
              status === 'video' ? 'opacity-100' : 'opacity-0'
            }`}
            src={source.src}
            poster={heroMedia.poster}
            // Deliberately no autoplay / loop / controls: scroll is the only
            // thing allowed to move this. muted + playsInline are what let iOS
            // decode a paused video at all.
            muted
            playsInline
            preload="auto"
            disablePictureInPicture
            aria-hidden="true"
          />

          {/* Fallback surface. Only painted if the video proves unscrubbable. */}
          <canvas
            ref={canvasRef}
            className={`hero-visual absolute inset-0 h-full w-full ${status === 'frames' ? 'opacity-100' : 'opacity-0'}`}
            aria-hidden="true"
          />

          {/* Poster underneath, so there is never a black hole while loading. */}
          {status === 'loading' && (
            <img
              src={heroMedia.poster}
              alt={heroProduct.alt}
              className="hero-visual absolute inset-0 h-full w-full object-contain"
              // Lowercase, spread: React 18 doesn't know the camelCase form and
              // passes it through as an unrecognised prop with a warning.
              {...{ fetchpriority: 'high' }}
            />
          )}
        </div>

        {/* Spotlight: crushes everything but the centre so only the garment is
            lit. Sits above the video, below the copy. */}
        <div className="pointer-events-none absolute inset-0 hero-spotlight" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-0 grain" aria-hidden="true" />

        {/* Opening copy — fades out as soon as the garment starts to move.
            Everything is pushed into the dark margins around the garment: the
            centre column belongs to the spotlight, so nothing is allowed to sit
            over it. On narrow screens the garment takes the full width, so the
            copy stacks above and below it instead of beside it. */}
        <div
          ref={introRef}
          className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between px-6 pb-20 pt-24 lg:px-12 lg:py-16"
        >
          {/* Hidden below lg: on a phone the garment reaches almost to the top
              of the viewport, and there is no dark band left to set this in. */}
          <span
            className="hidden animate-hero-in text-meta uppercase text-mist lg:block"
            style={{ animationDelay: '150ms' }}
          >
            {heroProduct.kicker}
          </span>
          <span className="lg:hidden" aria-hidden="true" />

          <div className="flex flex-col items-center gap-4 text-center lg:flex-row lg:items-end lg:justify-between lg:gap-6 lg:text-left">
            <h1
              className="animate-hero-in whitespace-pre-line font-display text-display-md leading-[0.95] text-pearl"
              style={{ animationDelay: '300ms' }}
            >
              {heroProduct.headline}
            </h1>

            <div className="pointer-events-auto flex flex-col items-center gap-4 lg:items-end lg:gap-6">
              {/* Below lg the copy stacks under the garment, and there is only
                  enough clear band for the headline and the button. */}
              <p
                className="hidden animate-hero-in text-body-lg text-mist lg:block"
                style={{ animationDelay: '550ms' }}
              >
                {heroProduct.tagline}
              </p>
              <Link
                to={heroProduct.cta.to}
                className="animate-hero-in border border-pearl/40 px-10 py-4 text-sm uppercase tracking-[0.2em] text-pearl transition-colors duration-500 ease-editorial hover:bg-pearl hover:text-obsidian"
                style={{ animationDelay: '750ms' }}
              >
                {heroProduct.cta.label}
              </Link>
            </div>
          </div>
        </div>


        {/* Closing copy — arrives only once the garment is fully apart. */}
        <div
          ref={outroRef}
          className="pointer-events-none absolute inset-x-0 bottom-0 z-10 px-6 pb-24 opacity-0 lg:px-12"
        >
          <div className="mx-auto flex max-w-[110rem] flex-col items-start gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-md">
              <span className="mb-3 block text-meta uppercase text-denim">
                {heroProduct.category}
              </span>
              <h2 className="mb-3 font-display text-display-md text-pearl">{heroProduct.name}</h2>
              <p className="text-sm leading-relaxed text-mist">{heroProduct.description}</p>
            </div>
            <div className="pointer-events-auto flex items-center gap-8">
              <span className="font-display text-2xl text-pearl">{price}</span>
              <Link
                to={heroProduct.viewCta.to}
                className="border border-pearl/40 px-8 py-3 text-sm uppercase tracking-[0.2em] text-pearl transition-colors duration-500 ease-editorial hover:bg-pearl hover:text-obsidian"
              >
                {heroProduct.viewCta.label}
              </Link>
            </div>
          </div>
        </div>

        {/* Progress rule. The only persistent chrome over the scene. */}
        <div className="pointer-events-none absolute inset-x-6 bottom-8 z-20 lg:inset-x-12">
          <div className="mb-3 flex items-center justify-between text-meta uppercase text-fog">
            <span ref={phaseRef}>{heroPhases[0].label}</span>
            {/* The scroll affordance lives in the HUD rather than floating over
                the scene — it is the one place chrome is already allowed. */}
            <span ref={cueRef} className="flex items-center gap-2 text-mist">
              Scroll to deconstruct
              <ChevronDown size={13} className="animate-bounce" aria-hidden="true" />
            </span>
            <span className="hidden text-mist lg:block">{heroProduct.name}</span>
          </div>
          <div className="h-px w-full bg-stone/40">
            <span
              ref={railRef}
              className="block h-full w-full origin-left bg-denim will-change-transform"
              style={{ transform: 'scaleX(0.015)' }}
              aria-hidden="true"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

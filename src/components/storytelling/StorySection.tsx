import { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { chapterFrames } from '../../assets/media';
import { prefersReducedMotion } from '../../hooks/useReducedMotion';

gsap.registerPlugin(ScrollTrigger);

const chapters = [
  {
    index: '01',
    kicker: 'The Fit',
    title: 'Sculpted\nby wear',
    body: 'Every pair is patterned from 47 body measurements. We engineer the fade lines before the first wash, so your denim ages with intention, not accident.',
    align: 'left',
  },
  {
    index: '02',
    kicker: 'The Fabric',
    title: 'Woven\nin Japan',
    body: '14oz selvedge from Kojima, shuttle-woven on vintage Toyoda looms. The irregular weave creates a surface that catches light like water.',
    align: 'right',
  },
  {
    index: '03',
    kicker: 'The Craft',
    title: 'One\nartisan',
    body: 'Each garment is cut, sewn, and finished by a single maker. Their signature is stitched inside — a promise that one person stood behind every seam.',
    align: 'left',
  },
  {
    index: '04',
    kicker: 'The Details',
    title: 'Hidden\nintentions',
    body: 'Copper rivets at stress points. Chain-stitched hems. Hidden pocket reinforcements. Details you discover over years, not seconds.',
    align: 'right',
  },
  {
    index: '05',
    kicker: 'The Signature',
    title: 'The Denimque\nCrest',
    body: 'Embossed leather patch, hand-stamped with the edition number. A mark of belonging for those who know what quality feels like.',
    align: 'center',
  },
] as const;

const alignClass = {
  left: 'justify-start text-left',
  right: 'justify-end text-left',
  center: 'justify-center text-center',
} as const;

/**
 * The scroll-driven film: one pinned viewport, five chapters that hand off to
 * each other, a crossfading backdrop per chapter, and a HUD reading `NN / 05`.
 *
 * A single scrubbed timeline drives everything so the copy, the image and the
 * progress bar can never disagree about where the reader is.
 */
export default function StorySection() {
  const sectionRef = useRef<HTMLElement>(null);
  const fillRef = useRef<HTMLSpanElement>(null);
  const chapterRef = useRef<HTMLSpanElement>(null);

  // useLayoutEffect, not useEffect: ScrollTrigger's `pin` moves this section
  // into a generated pin-spacer. The context must revert that reparenting
  // *before* React removes the nodes on route change, or React tries to
  // removeChild from a parent that no longer owns them and the tree crashes.
  useLayoutEffect(() => {
    if (prefersReducedMotion()) return;

    const ctx = gsap.context(() => {
      const panels = gsap.utils.toArray<HTMLElement>('.story-panel');
      const frames = gsap.utils.toArray<HTMLElement>('.story-frame');

      gsap.set(panels.slice(1), { opacity: 0, yPercent: 8 });
      gsap.set(frames.slice(1), { opacity: 0 });

      const tl = gsap.timeline({
        defaults: { ease: 'power2.inOut' },
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top top',
          // One viewport of scroll per handoff between chapters.
          end: () => `+=${window.innerHeight * (chapters.length - 1) * 1.15}`,
          pin: true,
          scrub: 1,
          anticipatePin: 1,
          onUpdate: (self) => {
            const active = Math.min(
              chapters.length - 1,
              Math.round(self.progress * (chapters.length - 1)),
            );
            if (chapterRef.current) chapterRef.current.textContent = chapters[active].index;
            if (fillRef.current) {
              gsap.set(fillRef.current, { scaleX: Math.max(0.02, self.progress) });
            }
          },
        },
      });

      // Chapter n out, chapter n+1 in — overlapping so there is never a blank frame.
      chapters.slice(1).forEach((_, i) => {
        tl.to(panels[i], { opacity: 0, yPercent: -8, duration: 0.5 })
          .to(frames[i], { opacity: 0, duration: 0.6 }, '<')
          .to(frames[i + 1], { opacity: 1, duration: 0.6 }, '<')
          .fromTo(
            panels[i + 1],
            { opacity: 0, yPercent: 8 },
            { opacity: 1, yPercent: 0, duration: 0.5 },
            '>-0.2',
          );
      });

      // Slow push on every frame, for depth while pinned.
      gsap.to(frames, {
        scale: 1.12,
        ease: 'none',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top top',
          end: () => `+=${window.innerHeight * (chapters.length - 1) * 1.15}`,
          scrub: 1,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative h-[100svh] overflow-hidden bg-obsidian"
      aria-label="The making of DENIMQUE, in five chapters"
    >
      {/* Backdrop stack — one frame per chapter, crossfaded by the timeline */}
      {chapterFrames.map((src) => (
        <div
          key={src}
          className="story-frame absolute inset-0 bg-cover bg-center opacity-100 will-change-transform"
          style={{ backgroundImage: `url(${src})` }}
          aria-hidden="true"
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-r from-obsidian via-obsidian/75 to-obsidian/45" />
      <div className="absolute inset-0 grain" aria-hidden="true" />

      {/* Chapter panels — stacked, only one visible at a time */}
      <div className="relative z-10 h-full">
        {chapters.map((chapter) => (
          <article
            key={chapter.index}
            className={`story-panel absolute inset-0 flex items-center px-6 lg:px-20 ${alignClass[chapter.align]}`}
          >
            <div className="max-w-xl">
              <span className="mb-1 block font-display text-6xl text-pearl/15 lg:text-8xl">
                {chapter.index}
              </span>
              <span className="mb-4 block text-meta uppercase text-denim">{chapter.kicker}</span>
              <h2 className="mb-6 whitespace-pre-line font-display text-display-lg text-pearl">
                {chapter.title}
              </h2>
              <p className="text-body-lg leading-relaxed text-mist">{chapter.body}</p>
            </div>
          </article>
        ))}
      </div>

      {/* HUD */}
      <div className="absolute inset-x-6 bottom-8 z-20 lg:inset-x-12">
        <div className="mb-3 flex items-center justify-between text-meta uppercase text-fog">
          <span>Denimque · The Collection</span>
          <span className="tabular-nums text-mist">
            <b ref={chapterRef} className="font-medium text-pearl">
              01
            </b>{' '}
            / 05
          </span>
        </div>
        <div className="h-px w-full bg-stone/40">
          <span
            ref={fillRef}
            className="block h-full w-full origin-left scale-x-0 bg-denim"
            aria-hidden="true"
          />
        </div>
      </div>
    </section>
  );
}

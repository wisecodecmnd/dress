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
    frame: chapterFrames['The Fit'],
    title: 'Sculpted\nby wear',
    body: 'Denimiq is where the structure of denim meets the fluidity of the human form. Every silhouette is thoughtfully engineered to move, settle and evolve with the wearer, creating a fit that becomes more personal with time. Our approach goes beyond conventional denim—we reinterpret familiar forms through sculptural tailoring, Indian silhouettes and contemporary proportions, making every piece feel distinctly Denimiq.',
    align: 'left',
  },
  {
    index: '02',
    kicker: 'The Fabric',
    frame: chapterFrames['The Fabric'],
    title: 'Woven\nin India',
    body: 'Exceptional denim begins with exceptional cloth. Our fabrics are thoughtfully woven in India, drawing from a rich textile heritage built on generations of weaving, craftsmanship and material knowledge. Denimiq brings that heritage into a modern canvas—transforming denim from a casual essential into something tactile, expressive and culturally rooted, with textures and washes designed to become more beautiful with every wear.',
    align: 'right',
  },
  {
    index: '03',
    kicker: 'The Craft',
    frame: chapterFrames['The Craft'],
    title: 'One\nartisan',
    body: 'Every Denimiq piece carries the human touch behind its creation. Inspired by India tradition of artisanal making, we bring together precision tailoring, considered construction and contemporary denim techniques, allowing each garment to retain a sense of individuality. From the first cut to the final stitch, the craft is intentional—because a truly distinctive garment should feel made, not manufactured.',
    align: 'left',
  },
  {
    index: '04',
    kicker: 'The Details',
    frame: chapterFrames['The Details'],
    title: 'Hidden\nintentions',
    body: 'The identity of Denimiq lives in the details. Traditional Indian design language is subtly woven into denim through considered motifs, borders, stitch techniques, handcrafted elements, architectural panels and unexpected finishing. Nothing exists merely for decoration; every detail has a purpose, creating pieces where heritage is discovered gradually and modernity meets tradition in an unexpected way.',
    align: 'right',
  },
  {
    index: '05',
    kicker: 'The Signature',
    frame: chapterFrames['The Signature'],
    title: 'The Denimque\nCrest',
    body: 'The Denimiq Crest represents our philosophy: heritage, individuality and the redefinition of denim. It is a signature of pieces created for those who see clothing as more than something to wear—a mark of belonging to a new expression of Indian design. Denimiq does not simply put tradition onto denim; we create a new language where Indian cultural richness and the attitude of contemporary denim exist as one.',
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
      {/* Backdrop stack — one frame per chapter, crossfaded by the timeline.
          Driven off `chapters` (not a parallel array) so frame N and panel N
          are guaranteed to describe the same chapter in both directions. */}
      {chapters.map((chapter) => (
        <div
          key={chapter.index}
          className="story-frame absolute inset-0 bg-cover bg-center opacity-100 will-change-transform"
          style={{ backgroundImage: `url("${chapter.frame}")` }}
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

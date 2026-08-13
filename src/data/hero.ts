/**
 * The hero campaign — every asset path, every word, and every piece of framing
 * geometry for the scroll-driven hero lives in this file.
 *
 * Swapping the campaign should never mean touching a component:
 *   - new render?      drop it in assets/source/, run `npm run hero:media`
 *   - new copy/price?  edit `heroProduct` below
 *   - new stills?      edit `heroProduct.gallery`
 *
 * Media paths themselves are NOT written here — they come from
 * `hero-media.json`, which the pipeline regenerates, so the runtime can never
 * disagree with what actually shipped.
 */
import media from './hero-media.json';

export interface HeroProduct {
  /**
   * The catalogue slug this campaign is for. Currently informational only —
   * `viewCta` is what the button actually points at, because this garment isn't
   * in the seed yet and a hero linking to a 404 is worse than one linking to the
   * shop. Once it exists, set `viewCta.to` to `/product/${slug}`.
   */
  slug: string;
  category: string;
  name: string;
  /** Small caps line above the headline. */
  kicker: string;
  /** Rendered as the h1. `\n` becomes a line break. */
  headline: string;
  tagline: string;
  cta: { label: string; to: string };
  /** The button shown beside the price once the garment is fully deconstructed. */
  viewCta: { label: string; to: string };
  description: string;
  price: number;
  currency: string;
  /** Alt text for the hero visual, in every mode it can render. */
  alt: string;
  /** Editorial stills for the PDP / quick view. First one is the primary. */
  gallery: { src: string; alt: string }[];
}

export const heroProduct: HeroProduct = {
  slug: 'the-indigo-lehenga',
  category: 'Atelier · Couture Denim',
  name: 'The Indigo Lehenga',
  // Kicker, headline and tagline are the repo's original hero copy, kept as-is.
  kicker: 'Est. 2018 · Biella',
  headline: 'DENIM,\nREDEFINED.',
  tagline: 'Built for those who refuse ordinary.',
  cta: { label: 'Explore Collection', to: '/shop' },
  viewCta: { label: 'View The Collection', to: '/shop' },
  description:
    'Hand-loomed indigo selvedge, faded by degrees from raw to bone, then embroidered in antique gold thread. Cut as independent panels so the silhouette can be rebuilt to any body.',
  // The rest of the store prices in INR; keep the hero consistent with it.
  price: 248000,
  currency: 'INR',
  alt: 'The Indigo Lehenga — an embroidered denim gown lit against black',
  gallery: [{ src: media.poster, alt: 'The Indigo Lehenga, lit against black' }],
};

/**
 * How much of the viewport the *garment* should occupy — not the video frame.
 *
 * `height` is the share of viewport height the complete dress fills at rest;
 * `width` is the hard ceiling on how wide the exploded dress may get before it
 * would touch the edges. The stage solves for a frame size that honours both,
 * using the measured subject box in hero-media.json.
 *
 * `lift` raises the garment by that share of viewport height, and
 * `reserveBelow` is the band beneath it that copy needs and the garment may not
 * enter. Wide screens set the copy beside the garment and need neither; narrow
 * ones stack it underneath, and that stack costs a roughly fixed number of
 * pixels (headline + button + padding) regardless of how tall the screen is —
 * which is why it is px and not a fraction.
 *
 * On a normal modern phone (>=812pt tall) the reserve is affordable and the
 * garment still lands at 65-68% of viewport height. On an unusually short
 * viewport it cannot be, and the solver shrinks the garment rather than letting
 * the headline sit on the hem.
 */
export const heroFraming = {
  desktop: { height: 0.68, width: 0.5, lift: 0, reserveBelow: 0 },
  tablet: { height: 0.66, width: 0.72, lift: 0.05, reserveBelow: 215 },
  mobile: { height: 0.65, width: 0.86, lift: 0.1, reserveBelow: 215 },
} as const;

/**
 * Scroll progress -> media progress.
 *
 * The render's internal pacing (complete until 2.0s, exploding until 5.9s)
 * doesn't match the beats the campaign calls for, so we remap rather than
 * re-render. Piecewise-linear and strictly monotonic, which is what makes
 * reverse scroll retrace the identical path.
 *
 *   scroll 0%   -> complete garment
 *   scroll 20%  -> last complete frame; separation is about to start
 *   scroll 45%  -> bodice and collar clear of the waist
 *   scroll 70%  -> bodice, waistband and skirt tiers all separated
 *   scroll 100% -> fully exploded
 */
export const heroBeats: readonly { scroll: number; second: number }[] = [
  { scroll: 0.0, second: 0.0 },
  { scroll: 0.2, second: 2.0 },
  { scroll: 0.45, second: 3.4 },
  { scroll: 0.7, second: 4.6 },
  { scroll: 1.0, second: 5.9 },
];

/** Chapter labels shown beside the progress rule while the hero is pinned. */
export const heroPhases: readonly { at: number; label: string }[] = [
  { at: 0.0, label: 'The Garment' },
  { at: 0.2, label: 'The Separation' },
  { at: 0.45, label: 'The Structure' },
  { at: 0.7, label: 'The Deconstruction' },
];

export const heroMedia = media;

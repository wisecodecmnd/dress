/**
 * Derives the backdrop tone for the shop carousel from the garment itself, so
 * the stage relights whenever the admin swaps a product image — no per-product
 * colour is ever configured in code.
 */

/**
 * Fallback tones, all pulled from the DENIMQUE palette family (deep indigo,
 * washed denim, and the muted naturals that sit beside them). Used when a
 * product image can't be read — never as a per-product assignment.
 */
const BRAND_TONES = [
  '#26374A', // indigo
  '#5C7C99', // denim
  '#3F4A44', // ink sage
  '#4A3F36', // tobacco
  '#3B3646', // slate plum
  '#2E4340', // deep pine
] as const;

/** Stable, so a product keeps the same tone across visits and re-renders. */
const hash = (seed: string) => {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return Math.abs(h);
};

export const fallbackTone = (seed: string): string => BRAND_TONES[hash(seed) % BRAND_TONES.length];

const cache = new Map<string, string | null>();

/**
 * Weighted average of an image's chromatic mid-tones — roughly the colour a
 * stylist would pull out of the shot.
 *
 * Resolves `null` when the pixels can't be read (a host that sends no CORS
 * header, a broken URL); callers fall back to `fallbackTone`. The off-screen
 * read is deliberately separate from the rendered `<img>`, so requesting CORS
 * here can never stop a product image from displaying.
 */
export function dominantColor(src: string): Promise<string | null> {
  const cached = cache.get(src);
  if (cached !== undefined) return Promise.resolve(cached);

  return new Promise((resolve) => {
    const done = (value: string | null) => {
      cache.set(src, value);
      resolve(value);
    };

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';

    img.onload = () => {
      try {
        const size = 24;
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return done(null);

        ctx.drawImage(img, 0, 0, size, size);
        const { data } = ctx.getImageData(0, 0, size, size);

        let r = 0;
        let g = 0;
        let b = 0;
        let weight = 0;

        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue;

          const pr = data[i];
          const pg = data[i + 1];
          const pb = data[i + 2];
          const max = Math.max(pr, pg, pb);
          const min = Math.min(pr, pg, pb);
          const luminance = (max + min) / 510;

          // Studio backdrops and shadow blow out the average and reduce every
          // garment to the same grey, so the extremes are dropped.
          if (luminance < 0.08 || luminance > 0.95) continue;

          // Saturated pixels carry the garment's actual colour; the small floor
          // keeps genuinely neutral pieces from yielding nothing at all.
          const w = (max - min) / 255 + 0.12;
          r += pr * w;
          g += pg * w;
          b += pb * w;
          weight += w;
        }

        if (weight === 0) return done(null);

        done(
          `rgb(${Math.round(r / weight)}, ${Math.round(g / weight)}, ${Math.round(b / weight)})`,
        );
      } catch {
        // Tainted canvas — the host allows the image but not reading it.
        done(null);
      }
    };

    img.onerror = () => done(null);
    img.src = src;
  });
}

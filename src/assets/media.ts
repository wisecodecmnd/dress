/**
 * Editorial imagery used by the marketing pages.
 *
 * These are remote placeholders for the shoot that hasn't happened yet — every
 * URL lives here so swapping in the real DENIMQUE campaign assets (or an S3/CDN
 * base path) is a single-file change. Product imagery comes from the API, not
 * from this file.
 */
const unsplash = (id: string, w: number) =>
  `https://images.unsplash.com/photo-${id}?q=80&w=${w}&auto=format&fit=crop`;

export const media = {
  heroPoster: unsplash('1541099649-83e6ea6e3de5', 2000),
  storyBackdrop: unsplash('1551028719-00167b16eac5', 2000),
  atelierWide: unsplash('1582418708-4d5f1d6d5e2e', 2000),
  craftPortrait: unsplash('1558618666-fcd25c85f82e', 1000),
  fabricPortrait: unsplash('1558171813-4c088753af8f', 1000),
  overshirt: unsplash('1596755099408-7921c7fb1b5e', 1000),
  productFallback: unsplash('1541099649-83e6ea6e3de5', 800),
} as const;

/**
 * Chapter backdrops for the scroll-driven film on the home page.
 *
 * Keyed by chapter kicker rather than positionally: the backdrop is bound to
 * the copy it sits behind, so reordering the chapters in StorySection can never
 * silently pair a frame with the wrong kicker.
 */
export const chapterFrames = {
  'The Fit': '/assets/images/story/story-01-the-fit.jpg',
  'The Fabric': '/assets/images/story/story-02-the-fabric.jpg',
  'The Craft': '/assets/images/story/story-03-the-craft.jpg',
  'The Details': '/assets/images/story/story-04-the-details.jpg',
  'The Signature': '/assets/images/story/story-05-the-signature.jpg',
} as const;

export type ChapterKicker = keyof typeof chapterFrames;

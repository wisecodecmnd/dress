/**
 * Solves the hero stage geometry.
 *
 * The campaign brief is written about the *garment* ("the dress should occupy
 * 60-75% of viewport height"), but what we can actually size is the video
 * frame, and the garment is only part of that frame — a different part at each
 * end of the animation. So we solve for a frame size from the measured subject
 * box in hero-media.json instead of hard-coding viewport percentages.
 *
 * Two constraints fight each other. The exploded silhouette is ~34% wider than
 * the complete one, so a frame big enough to show the complete dress at 70% of
 * viewport height will push the exploded dress off the sides of a phone. The
 * resolution is a camera pull-back: size the frame so the *exploded* state
 * exactly fits, then scale up at rest so the *complete* state hits its target.
 * The camera easing out as the garment comes apart reads as intentional
 * cinematography, and because it is a pure function of progress it reverses
 * perfectly along with everything else.
 */

export interface SubjectBox {
  /** Garment width as a fraction of frame width. */
  width: number;
  /** Garment height as a fraction of frame height. */
  height: number;
  /** Garment centre's offset right of frame centre, as a fraction of width. */
  offsetX: number;
}

export interface FramingTarget {
  /** Share of viewport height the complete garment should fill at rest. */
  height: number;
  /** Hard ceiling on the exploded garment's width, as a share of viewport. */
  width: number;
  /** Share of viewport height to raise the garment by, to clear stacked copy. */
  lift: number;
  /** Pixels below the garment that copy owns and the garment may not enter. */
  reserveBelow: number;
}

export interface StageFrame {
  /** Frame size in CSS pixels at scale 1 (the fully exploded state). */
  width: number;
  height: number;
  /** Scale applied at progress 0, easing to 1 at full deconstruction. */
  pullback: number;
  /** Horizontal correction in px at progress 0 and 1, to centre the garment. */
  panFrom: number;
  panTo: number;
  /** Constant upward offset in px, to clear copy stacked beneath the garment. */
  lift: number;
}

/** The exploded garment may not exceed this share of viewport height. */
const EXPLODED_MAX_HEIGHT = 0.8;
/** Guard against a pathological subject box demanding an absurd zoom. */
const MAX_PULLBACK = 1.6;

export function solveStageFrame(
  viewport: { width: number; height: number },
  aspect: number,
  subject: { complete: SubjectBox; exploded: SubjectBox },
  targetFraming: FramingTarget,
): StageFrame {
  const { complete, exploded } = subject;

  // Size the frame so the exploded state is the thing that just fits, on
  // whichever axis binds first.
  const byWidth = (targetFraming.width * viewport.width) / (exploded.width * aspect);
  const byHeight = (EXPLODED_MAX_HEIGHT * viewport.height) / exploded.height;
  const height = Math.min(byWidth, byHeight);
  const width = height * aspect;

  // Then zoom at rest until the complete garment reaches its target height...
  const wanted = (targetFraming.height * viewport.height) / (complete.height * height);
  // ...but never so far that the complete garment overflows the sides...
  const widthCeiling = (targetFraming.width * viewport.width) / (complete.width * width);
  // ...nor so far that its hem drops into the band the copy needs. The garment
  // is centred at `vh/2 - lift`, so its hem sits at half its height below that,
  // and everything from `vh - reserveBelow` down belongs to the headline.
  const room = 2 * (viewport.height * (0.5 + targetFraming.lift) - targetFraming.reserveBelow);
  const heightCeiling = room / (complete.height * height);
  // heightCeiling can legitimately land below 1 on a short viewport. Letting it
  // win there is the point: a smaller garment beats a headline on the hem.
  const pullback = Math.min(Math.max(wanted, 1), widthCeiling, heightCeiling, MAX_PULLBACK);

  // The render is not centred: the garment sits right of frame centre, by more
  // when whole than when exploded. Pan left to compensate, tracking the change.
  return {
    width,
    height,
    pullback,
    panFrom: -complete.offsetX * width * pullback,
    panTo: -exploded.offsetX * width,
    lift: -targetFraming.lift * viewport.height,
  };
}

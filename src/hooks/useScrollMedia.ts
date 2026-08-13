import { useCallback, useEffect, useRef, useState } from 'react';
import { gsap } from 'gsap';

/**
 * Drives a paused <video> — or a WebP frame sequence, if the video turns out
 * not to be scrubbable — from a scroll position.
 *
 * The contract is deliberately narrow: callers push a raw 0..1 progress value
 * whenever the scroll moves, and this hook owns everything after that. It eases
 * the value on GSAP's ticker (the same rAF loop Lenis already runs on, so we
 * add no second loop), coalesces seeks, and hands the eased value back through
 * `onFrame` so the caller's camera transform can never drift out of sync with
 * the garment.
 *
 * Nothing here triggers a React render except the `status` transition, which
 * happens at most twice in a page's lifetime. Per-frame work touches only the
 * media element and whatever `onFrame` writes to.
 */

export type ScrollMediaStatus = 'loading' | 'video' | 'frames' | 'failed';

interface Options {
  /** Media duration in seconds, from the pipeline manifest. */
  duration: number;
  /** Maps raw scroll progress to media progress. Must be monotonic. */
  remap: (progress: number) => number;
  /**
   * Share of the remaining distance to close each 60fps frame. Lower drifts
   * more cinematically; 1 would be instant and would feel mechanical.
   */
  smoothing?: number;
  frames?: { count: number; pattern: string };
  /** Called with the eased 0..1 progress on every ticker frame that moved. */
  onFrame?: (progress: number) => void;
}

/** A seek shorter than a third of a frame is invisible; don't pay for it. */
const SEEK_EPSILON = 1 / 90;
/** If a seek hasn't reported back by now the element is wedged — seek anyway. */
const SEEK_TIMEOUT_MS = 220;
/** No `seeked` at all this long after the first attempt means video is a dead end. */
const VIDEO_WATCHDOG_MS = 2500;
/** Below this, the lerp is asymptotic noise. Snap and stop seeking. */
const REST_EPSILON = 0.0004;

export function useScrollMedia({
  duration,
  remap,
  smoothing = 0.12,
  frames,
  onFrame,
}: Options) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [status, setStatus] = useState<ScrollMediaStatus>('loading');
  const statusRef = useRef<ScrollMediaStatus>('loading');

  /** Where scroll says we are, and where we've actually eased to. */
  const target = useRef(0);
  const eased = useRef(0);

  /** Set by whichever mode is live. Swapped, not branched, per frame. */
  const paint = useRef<((progress: number) => void) | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const remapRef = useRef(remap);
  remapRef.current = remap;

  const setProgress = useCallback((p: number) => {
    target.current = p < 0 ? 0 : p > 1 ? 1 : p;
  }, []);

  /** Jump with no easing — for restoring position on mount or after a resize. */
  const snapProgress = useCallback((p: number) => {
    const c = p < 0 ? 0 : p > 1 ? 1 : p;
    target.current = c;
    eased.current = c;
  }, []);

  const commit = useCallback((next: ScrollMediaStatus) => {
    if (statusRef.current === next) return;
    statusRef.current = next;
    setStatus(next);
  }, []);

  /* ----------------------------------------------------------- the ticker */

  useEffect(() => {
    let last = -1;
    const tick = () => {
      const distance = target.current - eased.current;
      if (Math.abs(distance) < REST_EPSILON) {
        if (eased.current === target.current && eased.current === last) return;
        eased.current = target.current;
      } else {
        eased.current += distance * smoothing;
      }
      last = eased.current;
      paint.current?.(eased.current);
      onFrameRef.current?.(eased.current);
    };

    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [smoothing]);

  /* ------------------------------------------------------------ video mode */

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    let disposed = false;
    let seeking = false;
    let seekStartedAt = 0;
    let sawSeeked = false;
    let watchdog = 0;
    let painted = -1;

    const onSeeked = () => {
      seeking = false;
      sawSeeked = true;
      window.clearTimeout(watchdog);
    };

    const onReady = () => {
      if (disposed || statusRef.current !== 'loading') return;
      // iOS refuses to decode frames for a video that has never played, so kick
      // it once and pause immediately. muted + playsInline keeps this allowed
      // without a user gesture; if the policy still refuses, the watchdog
      // catches it and we fall back to stills.
      void video.play().then(
        () => !disposed && video.pause(),
        () => {
          /* autoplay refused — seeking usually still works, so carry on */
        },
      );
      video.pause();
      commit('video');
    };

    const onError = () => commit(frames ? 'frames' : 'failed');

    // readyState can already be past HAVE_CURRENT_DATA if the file was cached.
    if (video.readyState >= 2) onReady();
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);

    paint.current = (progress) => {
      if (statusRef.current !== 'video') return;
      const seconds = remapRef.current(progress) * duration;
      if (Math.abs(seconds - painted) < SEEK_EPSILON) return;
      painted = seconds;

      // A seek already in flight will be superseded; letting it finish avoids
      // the stutter Safari shows when currentTime is rewritten mid-seek.
      if (seeking && performance.now() - seekStartedAt <= SEEK_TIMEOUT_MS) return;
      seeking = true;
      seekStartedAt = performance.now();
      video.currentTime = seconds;

      if (!sawSeeked && !watchdog) {
        watchdog = window.setTimeout(() => {
          // currentTime was accepted but nothing ever decoded. Only the frame
          // sequence can save this; without one the poster stays up.
          if (!sawSeeked && !disposed) commit(frames ? 'frames' : 'failed');
        }, VIDEO_WATCHDOG_MS);
      }
    };

    return () => {
      disposed = true;
      window.clearTimeout(watchdog);
      if (paint.current) paint.current = null;
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
  }, [duration, frames, commit]);

  /* ----------------------------------------------------------- frames mode */

  useEffect(() => {
    if (status !== 'frames' || !frames) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    const images = new Array<HTMLImageElement | undefined>(frames.count);
    const src = (i: number) => frames.pattern.replace('{i}', String(i + 1).padStart(3, '0'));

    const load = (i: number) => {
      if (i < 0 || i >= frames.count || images[i]) return;
      const img = new Image();
      img.decoding = 'async';
      img.src = src(i);
      images[i] = img;
    };

    // Coarse-to-fine: a sparse pass makes the whole timeline scrubbable for a
    // few hundred KB, then the gaps fill in while the visitor reads the copy.
    // Requesting all 90 up front would stall the hero on a phone.
    for (let i = 0; i < frames.count; i += 6) load(i);
    const backfill = window.setTimeout(() => {
      for (let i = 0; i < frames.count; i += 1) load(i);
    }, 1200);

    /** Nearest decoded frame, so a gap shows a neighbour rather than blank. */
    const resolve = (i: number) => {
      for (let d = 0; d < frames.count; d += 1) {
        const lo = images[i - d];
        if (lo?.complete && lo.naturalWidth) return lo;
        const hi = images[i + d];
        if (hi?.complete && hi.naturalWidth) return hi;
      }
      return undefined;
    };

    let lastIndex = -1;
    paint.current = (progress) => {
      const index = Math.min(
        frames.count - 1,
        Math.round(remapRef.current(progress) * (frames.count - 1)),
      );
      if (index === lastIndex) return;
      const img = resolve(index);
      if (!img) return;
      lastIndex = index;

      if (canvas.width !== img.naturalWidth) {
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
      }
      ctx.drawImage(img, 0, 0);
      // Pull in what's about to be needed, in whichever direction we're moving.
      load(index + (target.current >= eased.current ? 1 : -1));
    };

    return () => {
      window.clearTimeout(backfill);
      paint.current = null;
    };
  }, [status, frames]);

  return { videoRef, canvasRef, status, setProgress, snapProgress };
}

/**
 * Builds a monotonic piecewise-linear scroll -> media-progress remap from a
 * beat table, so campaign pacing is a data change rather than a re-render.
 */
export function buildRemap(
  beats: readonly { scroll: number; second: number }[],
  duration: number,
) {
  const points = [...beats].sort((a, b) => a.scroll - b.scroll);
  return (p: number) => {
    if (p <= points[0].scroll) return points[0].second / duration;
    for (let i = 1; i < points.length; i += 1) {
      const a = points[i - 1];
      const b = points[i];
      if (p <= b.scroll) {
        const span = b.scroll - a.scroll;
        const t = span === 0 ? 0 : (p - a.scroll) / span;
        return (a.second + (b.second - a.second) * t) / duration;
      }
    }
    return points[points.length - 1].second / duration;
  };
}

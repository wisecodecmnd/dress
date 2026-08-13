/**
 * Hero media pipeline — turns a raw Google Flow render into scrub-ready assets.
 *
 *   npm run hero:media
 *
 * Why this exists: a normal delivery MP4 is the worst possible input for
 * scroll-scrubbing. The source we were handed is 25.7 MB, carries its `moov`
 * atom *after* `mdat` (so a browser must download the whole file before it can
 * seek at all), and has 2 keyframes across 300 frames — every `currentTime`
 * write would force the decoder to replay up to 150 frames.
 *
 * So we re-encode all-intra (`-g 1`): every frame is a keyframe, seeking is
 * O(1), and `+faststart` moves the index to the front so playback can begin
 * mid-download. Costs ~2x the bitrate of a normal GOP and is still 7x smaller
 * than the source, because we also trim the tail (see SCRUB_END below).
 *
 * Outputs land in public/assets/ and are the only video files committed; the
 * master under assets/source/ is gitignored.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const SOURCE = join(root, 'assets/source/denimque-hero-dress.mp4');

/**
 * The scrub window, in seconds of source footage.
 *
 * The render's own arc is complete -> separating -> exploded -> *reassembled*,
 * and it returns to the complete dress by 10s. We only want the first half:
 * scroll progress 0..1 maps onto 0..SCRUB_END, so 100% scroll lands on peak
 * deconstruction. Scrolling back up replays that identical segment in reverse,
 * which is what makes the dress reassemble — one timeline, both directions.
 * Keeping the source's own reassembly footage would mean 100% scroll showed a
 * complete dress again, and would double the file for frames nobody sees.
 *
 * 5.9s is the measured peak-separation frame. Re-measure if the render changes.
 */
const SCRUB_START = 0;
const SCRUB_END = 5.9;

/**
 * Where the garment actually sits in the frame, as fractions of frame size,
 * measured off a 10x10 grid overlay at both ends of the scrub window.
 *
 * The stage needs this to size the *garment* rather than the video: a raw
 * `height: 70vh` on the video would leave the dress at whatever size the render
 * happened to use. It also reveals that this render is not centred — the
 * garment sits right of frame centre, by more when whole than when exploded —
 * so the stage pans to compensate. Re-measure with:
 *
 *   ffmpeg -ss <t> -i <src> -frames:v 1 -vf "scale=960:540,drawgrid=w=96:h=54:t=1:c=red" out.png
 */
const SUBJECT = {
  complete: { width: 0.26, height: 0.88, offsetX: 0.078 },
  exploded: { width: 0.349, height: 0.98, offsetX: 0.034 },
};

/** Desktop: 1280 wide is enough — the dress occupies ~35% of frame width. */
const DESKTOP_WIDTH = 1280;
/** Mobile is scaled up more by the camera pull-back, so it can't go as low. */
const MOBILE_WIDTH = 1080;
/** CRF 28 all-intra keeps the gold embroidery clean; verified by eye at 1:1. */
const DESKTOP_CRF = 28;
const MOBILE_CRF = 31;
/** Fallback stills. 90 across the window ~= 15fps of scrub — smooth enough. */
const FRAME_COUNT = 90;
const FRAME_WIDTH = 720;
const FRAME_QUALITY = 74;

const out = {
  videos: join(root, 'public/assets/videos'),
  frames: join(root, 'public/assets/frames'),
  images: join(root, 'public/assets/images'),
};

const run = (args) => execFileSync(ffmpeg, ['-y', '-v', 'error', ...args], { stdio: 'inherit' });
const mb = (p) => (statSync(p).size / 1048576).toFixed(2) + ' MB';

/**
 * Reads display dimensions out of an MP4's first `tkhd` box.
 *
 * ffmpeg-static ships no ffprobe, and the stage needs the real aspect ratio to
 * do its framing maths — assuming 16:9 would silently mis-size the garment the
 * day someone swaps in a portrait render.
 */
function readAspect(file) {
  const buf = readFileSync(file);
  let found = null;
  (function walk(start, end) {
    let off = start;
    while (off + 8 <= end && !found) {
      let size = buf.readUInt32BE(off);
      const type = buf.toString('latin1', off + 4, off + 8);
      let hdr = 8;
      if (size === 1) {
        size = Number(buf.readBigUInt64BE(off + 8));
        hdr = 16;
      }
      if (size === 0) size = end - off;
      if (size < hdr) return;
      if (type === 'tkhd') {
        const b = off + hdr;
        // v0 lays width/height out at +76; v1's 64-bit times push it to +88.
        const p = b + (buf[b] === 1 ? 88 : 76);
        const w = buf.readUInt32BE(p) / 65536;
        const h = buf.readUInt32BE(p + 4) / 65536;
        if (w && h) found = { width: w, height: h };
      }
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) walk(off + hdr, off + size);
      off += size;
    }
  })(0, buf.length);
  if (!found) throw new Error(`Could not read dimensions from ${file}`);
  return found;
}
const duration = SCRUB_END - SCRUB_START;

/** Shared trim + de-audio. Placing -ss before -i keeps the seek fast. */
const input = ['-ss', String(SCRUB_START), '-t', String(duration), '-i', SOURCE, '-an'];

/** All-intra H.264: -g 1 plus sc_threshold 0 so x264 can't insert its own GOP. */
const intra = (crf, width) => [
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', String(crf),
  '-g', '1',
  '-keyint_min', '1',
  '-sc_threshold', '0',
  '-pix_fmt', 'yuv420p',
  '-vf', `scale=${width}:-2`,
  '-movflags', '+faststart',
];

function main() {
  if (!statSync(SOURCE, { throwIfNoEntry: false })) {
    console.error(`Source not found: ${SOURCE}\nDrop the master render there and re-run.`);
    process.exit(1);
  }

  for (const dir of Object.values(out)) mkdirSync(dir, { recursive: true });
  // Stale frames from a previous, longer render would be served forever.
  rmSync(out.frames, { recursive: true, force: true });
  mkdirSync(out.frames, { recursive: true });

  console.log(`source          ${mb(SOURCE)}`);
  console.log(`scrub window    ${SCRUB_START}s -> ${SCRUB_END}s (${duration}s)\n`);

  const desktopMp4 = join(out.videos, 'denimque-hero-dress.mp4');
  run([...input, ...intra(DESKTOP_CRF, DESKTOP_WIDTH), desktopMp4]);
  console.log(`desktop mp4     ${mb(desktopMp4)}`);

  const mobileMp4 = join(out.videos, 'denimque-hero-dress-mobile.mp4');
  run([...input, ...intra(MOBILE_CRF, MOBILE_WIDTH), mobileMp4]);
  console.log(`mobile mp4      ${mb(mobileMp4)}`);

  // Poster: first frame, shown until the video has enough data to seek.
  const poster = join(out.images, 'denimque-hero-dress-poster.webp');
  run([
    '-ss', String(SCRUB_START), '-i', SOURCE,
    '-frames:v', '1', '-vf', `scale=${DESKTOP_WIDTH}:-2`, '-quality', '82', poster,
  ]);
  console.log(`poster          ${mb(poster)}`);

  // Frame sequence: the fallback for devices where seeking a video is unreliable
  // (notably older iOS, which refuses to decode while not playing).
  run([
    ...input,
    '-vf', `fps=${(FRAME_COUNT / duration).toFixed(6)},scale=${FRAME_WIDTH}:-2`,
    '-frames:v', String(FRAME_COUNT),
    '-c:v', 'libwebp',
    '-quality', String(FRAME_QUALITY),
    // Without an explicit image2 muxer ffmpeg picks the `webp` muxer and writes
    // one *animated* WebP instead of a numbered sequence.
    '-f', 'image2',
    join(out.frames, 'frame-%03d.webp'),
  ]);

  const frames = readdirSync(out.frames).filter((f) => f.endsWith('.webp')).sort();
  const framesBytes = frames.reduce((n, f) => n + statSync(join(out.frames, f)).size, 0);
  console.log(`frames          ${frames.length} files, ${(framesBytes / 1048576).toFixed(2)} MB`);

  // Written, not hand-maintained, so the runtime can never disagree with what
  // actually shipped. Editorial copy stays in src/data/hero.ts.
  // Per-variant, not shared: rounding to even pixel heights already makes the
  // two encodes differ slightly, and a future portrait mobile crop would differ
  // a lot. The stage's framing maths divides by this, so it has to be the
  // aspect of the file actually being played.
  const aspectOf = (file) => {
    const d = readAspect(file);
    console.log(`aspect          ${d.width}x${d.height}  ${(d.width / d.height).toFixed(5)}`);
    return Number((d.width / d.height).toFixed(5));
  };

  const manifest = {
    _generated: 'npm run hero:media — do not edit by hand',
    duration,
    subject: SUBJECT,
    video: {
      desktop: { src: '/assets/videos/denimque-hero-dress.mp4', aspect: aspectOf(desktopMp4) },
      mobile: { src: '/assets/videos/denimque-hero-dress-mobile.mp4', aspect: aspectOf(mobileMp4) },
    },
    poster: '/assets/images/denimque-hero-dress-poster.webp',
    frames: {
      count: frames.length,
      // %03d — index 1..count, matching ffmpeg's output numbering.
      pattern: '/assets/frames/frame-{i}.webp',
      width: FRAME_WIDTH,
    },
  };
  const manifestPath = join(root, 'src/data/hero-media.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest        src/data/hero-media.json`);
}

main();

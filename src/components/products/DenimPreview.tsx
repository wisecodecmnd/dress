interface DenimPreviewProps {
  wash: string;
  stitch: string;
  buttons: string;
  patch: string;
  embroidery: string;
  fit: string;
  backPocket: string;
}

/**
 * Live preview for the configurator. Vector, not photography, so every
 * combination renders truthfully at any size and costs nothing to load —
 * the wash, stitch and hardware colours come straight from the selection.
 */
export default function DenimPreview({
  wash,
  stitch,
  buttons,
  patch,
  embroidery,
  fit,
  backPocket,
}: DenimPreviewProps) {
  // Fit changes the leg taper: the inner edge of each leg moves outward/inward.
  const taper = fit === 'skinny' ? 26 : fit === 'slim' ? 18 : fit === 'straight' ? 8 : 0;

  return (
    <svg
      viewBox="0 0 240 400"
      className="h-full w-full"
      role="img"
      aria-label={`Preview: ${fit} fit jean in ${wash} wash with ${stitch} stitching`}
    >
      <defs>
        <linearGradient id="washGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={wash} stopOpacity="1" />
          <stop offset="55%" stopColor={wash} stopOpacity="0.88" />
          <stop offset="100%" stopColor={wash} stopOpacity="0.97" />
        </linearGradient>

        {/* Soft highlight down the thigh, where real denim fades first */}
        <radialGradient id="fade" cx="0.5" cy="0.32" r="0.5">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Body */}
      <path
        d={`M60 30 H180 L188 120 L${170 - taper / 2} 380 H136 L120 190 L104 380 H70 L${52 + taper / 2} 120 Z`}
        fill="url(#washGrad)"
        stroke={stitch}
        strokeWidth="1.6"
        strokeDasharray="5 3"
      />
      <path
        d={`M60 30 H180 L188 120 L${170 - taper / 2} 380 H136 L120 190 L104 380 H70 L${52 + taper / 2} 120 Z`}
        fill="url(#fade)"
      />

      {/* Waistband */}
      <rect x="58" y="24" width="124" height="20" fill={wash} stroke={stitch} strokeWidth="1.4" />
      <line x1="58" y1="44" x2="182" y2="44" stroke={stitch} strokeWidth="1" strokeDasharray="4 3" />

      {/* Fly + button */}
      <line x1="120" y1="46" x2="120" y2="96" stroke={stitch} strokeWidth="1.2" strokeDasharray="4 3" />
      <circle cx="120" cy="34" r="5" fill={buttons} stroke={stitch} strokeWidth="0.8" />

      {/* Rivets */}
      {[
        [72, 92],
        [168, 92],
        [82, 118],
        [158, 118],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2.6" fill={buttons} />
      ))}

      {/* Back pocket shape */}
      {backPocket !== 'none' && (
        <g stroke={stitch} strokeWidth="1.3" fill="none">
          {backPocket === 'curved' && <path d="M74 108 H108 V132 Q91 146 74 132 Z" />}
          {backPocket === 'v-stitch' && (
            <>
              <path d="M74 108 H108 V138 H74 Z" />
              <path d="M74 112 L91 126 L108 112" />
            </>
          )}
          {backPocket === 'square' && <path d="M74 108 H108 V138 H74 Z" />}
          {backPocket === 'arcuate' && (
            <>
              <path d="M74 108 H108 V138 H74 Z" />
              <path d="M74 118 Q91 132 108 118" />
            </>
          )}
        </g>
      )}

      {/* Leather patch */}
      {patch !== 'none' && (
        <g>
          <rect
            x="140"
            y="52"
            width="34"
            height="22"
            rx={patch === 'rounded' ? 6 : 1}
            fill={patch === 'black-leather' ? '#1b1b1e' : patch === 'jacron' ? '#e6dfd2' : '#7b5433'}
            stroke={stitch}
            strokeWidth="1"
          />
          <text
            x="157"
            y="66"
            textAnchor="middle"
            fontSize="7"
            letterSpacing="1"
            fill={patch === 'jacron' ? '#1b1b1e' : '#f4f2ee'}
            fontFamily="Inter, sans-serif"
          >
            DQ
          </text>
        </g>
      )}

      {/* Embroidery on the thigh */}
      {embroidery !== 'none' && (
        <text
          x="88"
          y="200"
          fontSize="11"
          fill={stitch}
          fontFamily="Cormorant Garamond, serif"
          fontStyle="italic"
          opacity="0.9"
        >
          {embroidery === 'monogram' ? 'DQ' : embroidery === 'signature' ? 'Denimque' : '·'}
        </text>
      )}

      {/* Selvedge line down the outseam */}
      <line x1="58" y1="46" x2={54 + taper / 2} y2="380" stroke={stitch} strokeWidth="0.9" opacity="0.7" />
      <line x1="182" y1="46" x2={186 - taper / 2} y2="380" stroke={stitch} strokeWidth="0.9" opacity="0.7" />
    </svg>
  );
}

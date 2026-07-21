/**
 * Clouds.tsx
 *
 * The drifting cloud banks. Each bank is a `.cloud-band` holding two identical
 * strips side by side; the band slides exactly one strip width, so the drift
 * loops forever with no visible seam.
 *
 * A cloud that runs off one edge is drawn again 1400 units away on the other,
 * so the two cut halves meet across the seam and read as a single cloud.
 * Anything else stays clear of the edges: the strip clips, and a clipped cloud
 * shows a hard vertical cut.
 *
 * `floor` welds the puffs onto a solid deck that runs past the bottom of the
 * viewBox — without it the bank is hollow underneath and the sky shows through
 * below the clouds.
 *
 * Ported from website/src/components/Hero.tsx.
 */

import React from "react"

type Puff = { cx: number; cy: number; r: number }

/* Cloud silhouettes — overlapping puffs that the goo filter fuses into a
   single soft cumulus. Drawn on a 0..400 x 0..200 mound. */
const CLOUD_SHAPES: Puff[][] = [
  [
    { cx: 58, cy: 120, r: 52 }, { cx: 126, cy: 84, r: 70 }, { cx: 212, cy: 68, r: 86 },
    { cx: 298, cy: 94, r: 64 }, { cx: 360, cy: 126, r: 46 }, { cx: 110, cy: 152, r: 54 },
    { cx: 205, cy: 154, r: 62 }, { cx: 292, cy: 150, r: 50 }
  ],
  [
    { cx: 50, cy: 132, r: 44 }, { cx: 112, cy: 96, r: 62 }, { cx: 186, cy: 82, r: 74 },
    { cx: 258, cy: 108, r: 54 }, { cx: 312, cy: 136, r: 40 }, { cx: 150, cy: 156, r: 50 },
    { cx: 232, cy: 158, r: 46 }
  ],
  [
    { cx: 64, cy: 110, r: 58 }, { cx: 146, cy: 74, r: 78 }, { cx: 236, cy: 92, r: 66 },
    { cx: 316, cy: 118, r: 52 }, { cx: 380, cy: 140, r: 38 }, { cx: 130, cy: 150, r: 56 },
    { cx: 246, cy: 152, r: 54 }
  ]
]

type CloudProps = { shape: number; x: number; y: number; scale: number }

function Cloud({ shape, x, y, scale }: CloudProps) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      {CLOUD_SHAPES[shape].map((p, i) => (
        <circle key={i} cx={p.cx} cy={p.cy} r={p.r} />
      ))}
    </g>
  )
}

/* Back layer — small, distant clouds high in the sky. */
const FAR_CLOUDS: CloudProps[] = [
  { shape: 1, x: 300, y: 10, scale: 0.4 },
  { shape: 2, x: 720, y: -6, scale: 0.3 },
  { shape: 0, x: 1040, y: 16, scale: 0.36 }
]

/* Mid layer — smaller and higher, so it reads as further away. It carries no
   floor: everything below its puffs is hidden behind the near bank. */
const MID_CLOUDS: CloudProps[] = [
  { shape: 2, x: -160, y: 22, scale: 0.55 }, // ┐ same cloud, split
  { shape: 2, x: 1240, y: 22, scale: 0.55 }, // ┘ across the seam
  { shape: 0, x: 180, y: 28, scale: 0.5 },
  { shape: 1, x: 480, y: 18, scale: 0.58 },
  { shape: 2, x: 760, y: 26, scale: 0.52 },
  { shape: 0, x: 1000, y: 20, scale: 0.54 }
]

/* Front layer — the big fluffy floor of the sky. These overlap along the whole
   strip so the deck's straight top edge never shows between two puffs. */
const NEAR_CLOUDS: CloudProps[] = [
  { shape: 0, x: -120, y: 68, scale: 0.75 }, // ┐ same cloud, split
  { shape: 0, x: 1280, y: 68, scale: 0.75 }, // ┘ across the seam
  { shape: 1, x: 130, y: 58, scale: 0.8 },
  { shape: 2, x: 350, y: 64, scale: 0.72 },
  { shape: 0, x: 600, y: 55, scale: 0.78 },
  { shape: 1, x: 850, y: 62, scale: 0.75 },
  { shape: 2, x: 1060, y: 58, scale: 0.7 }
]

/**
 * The shared cloud paint and goo filter. Must be rendered once, above every
 * <CloudBank /> in the tree — the banks reference these ids.
 *
 * `seam` is the colour the deck ends on. Whatever sits directly below the
 * clouds has to open on exactly this colour or a line appears across the
 * surface; the ramp also has to *end* where the deck starts (y2=170, not 220)
 * so the deck itself is a flat band rather than a second, faster gradient.
 */
export function CloudDefs({ seam = "#E3D3F8" }: { seam?: string }) {
  return (
    <svg className="absolute h-0 w-0" aria-hidden focusable="false">
      <defs>
        {/* fuses the puffs of a cloud into one silhouette, then softens the rim */}
        <filter
          id="ext-cloudy"
          x="-20%"
          y="-40%"
          width="140%"
          height="200%"
          colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="b" />
          <feColorMatrix
            in="b"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8"
            result="goo"
          />
          <feGaussianBlur in="goo" stdDeviation="1.6" />
        </filter>
        {/* userSpaceOnUse, not the default bounding box: the deck runs far below
            the viewBox, so a bbox gradient would only reach ~45% of the way
            through its stops by the bottom edge — and where the ramp lands
            would shift with every cloud added. */}
        <linearGradient id="ext-cloud-near" gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="0" y2="170">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.5" stopColor="#F4EAFF" />
          <stop offset="1" stopColor={seam} />
        </linearGradient>
        <linearGradient id="ext-cloud-mid" gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="0" y2="220">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.85" />
          <stop offset="0.5" stopColor="#E7D8FB" stopOpacity="0.7" />
          <stop offset="1" stopColor="#CDB4F2" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="ext-cloud-far" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.5" />
          <stop offset="1" stopColor="#D8C6F5" stopOpacity="0.28" />
        </linearGradient>
        {/* <CloudCard />'s paint. Here rather than inside the card so a page
            can carry several of them without minting a duplicate id each time.
            Spans the card's whole viewBox (-16..316), userSpaceOnUse for the
            same reason the bank gradients are. */}
        <linearGradient id="ext-card-paint" gradientUnits="userSpaceOnUse" x1="0" y1="-16" x2="0" y2="316">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.55" stopColor="#F6EFFF" />
          <stop offset="1" stopColor="#E3D3F8" />
        </linearGradient>

        {/* ── the same weather after dark ──
            Noid mode's sky is a deep violet, and the day palette on it reads as
            white paper cut out and pasted on rather than as cloud. These bottom
            out close to the storm they sit in — only the lit crown separates,
            and the drop-shadow does the rest. Lifted from the site's
            `wm-card-noid`, which solves the same problem. */}
        <linearGradient id="ext-cloud-near-storm" gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="0" y2="170">
          <stop offset="0" stopColor="#8E72CE" />
          <stop offset="0.5" stopColor="#6A4FA8" />
          <stop offset="1" stopColor="#4A3379" />
        </linearGradient>
        <linearGradient id="ext-cloud-mid-storm" gradientUnits="userSpaceOnUse" x1="0" y1="30" x2="0" y2="220">
          <stop offset="0" stopColor="#9C80DA" stopOpacity="0.7" />
          <stop offset="0.5" stopColor="#6C51AA" stopOpacity="0.6" />
          <stop offset="1" stopColor="#432E70" stopOpacity="0.5" />
        </linearGradient>
        <linearGradient id="ext-cloud-far-storm" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#B9A0F0" stopOpacity="0.34" />
          <stop offset="1" stopColor="#5C3F97" stopOpacity="0.18" />
        </linearGradient>
        <linearGradient id="ext-card-paint-storm" gradientUnits="userSpaceOnUse" x1="0" y1="-16" x2="0" y2="316">
          <stop offset="0" stopColor="#7A5EBC" />
          <stop offset="0.55" stopColor="#5B3F97" />
          <stop offset="1" stopColor="#3E2872" />
        </linearGradient>
      </defs>
    </svg>
  )
}

function CloudStrip({
  clouds,
  gradient,
  floor
}: {
  clouds: CloudProps[]
  gradient: string
  floor?: boolean
}) {
  return (
    <svg viewBox="0 0 1400 220" aria-hidden focusable="false">
      <g fill={`url(#${gradient})`} filter="url(#ext-cloudy)">
        {floor && <rect x={-60} y={165} width={1520} height={260} />}
        {clouds.map((c, i) => (
          <Cloud key={i} {...c} />
        ))}
      </g>
    </svg>
  )
}

/**
 * One drifting bank. `layer` picks the depth: "far" sits high and pale, "mid"
 * is the second row of the floor, "near" is the solid front bank that carries
 * the deck.
 *
 * `height` picks how much of the surface the floor is allowed to eat. "full" is
 * the site's weather — big cumulus, ~16% of the viewport width tall. "low"
 * halves it by splitting the same band into four narrower strips instead of
 * two, for pages where a panel has to stand on the remaining sky. "auto" hands
 * the choice to a media query on window height (see `.cloud-band-auto`) and so
 * has to ship four strips whatever it ends up drawing — above the breakpoint
 * the spare two run off the side of a band the page already clips. The count
 * has to stay even; `.cloud-band` says why.
 */
export function CloudBank({
  layer,
  height = "full",
  tone = "day",
  className = ""
}: {
  layer: "far" | "mid" | "near"
  height?: "full" | "low" | "auto"
  /** "storm" is the same weather over noid mode's dark sky. */
  tone?: "day" | "storm"
  className?: string
}) {
  const cfg = {
    far: { clouds: FAR_CLOUDS, gradient: "ext-cloud-far", floor: false, drift: "cloud-drift-rev" },
    mid: { clouds: MID_CLOUDS, gradient: "ext-cloud-mid", floor: false, drift: "cloud-drift-slow" },
    near: { clouds: NEAR_CLOUDS, gradient: "ext-cloud-near", floor: true, drift: "cloud-drift" }
  }[layer]

  const gradient = tone === "storm" ? `${cfg.gradient}-storm` : cfg.gradient
  const sizeClass = { full: "", low: "cloud-band-low", auto: "cloud-band-auto" }[height]
  const strips = height === "full" ? 2 : 4

  return (
    <div className={`cloud-band ${sizeClass} ${cfg.drift} ${className}`}>
      {Array.from({ length: strips }).map((_, i) => (
        <CloudStrip key={i} clouds={cfg.clouds} gradient={gradient} floor={cfg.floor} />
      ))}
    </div>
  )
}

/* ── CloudCard ──
   A cloud that stretches to whatever height its content needs, so a stack of
   controls can sit *on* one cloud rather than beside it. A fixed-aspect cumulus
   cannot do this: its widest band is a thin slice ~37% down, and anything tall
   enough to hold a mark, a field and a button runs off the tapering ends.

   The trick is `preserveAspectRatio="none"` plus a solid body under the puffs.
   The body guarantees the middle is filled whatever the stretch; the content's
   percentage padding keeps every line inside it.

   Ported from `CardCloud` in website/src/components/WalletModes.tsx, including
   its two hard-won rules:
     - the body is pulled well inside the ring, so every edge of the silhouette
       is a puff and none of it is the rect. Let a rect edge reach the outline
       and you get a straight run down the side, which is the one thing that
       stops it reading as a cloud.
     - puff sizes vary on purpose. A dozen bumps of the same radius spaced
       evenly round the edge is a doily, not a cloud. */
const CARD_BODY = { x: 90, y: 100, w: 220, h: 100 }
const CARD_PUFFS: [number, number, number][] = [
  // top: one big crown with a shoulder either side
  [118, 84, 56], [208, 62, 76], [292, 86, 58],
  // two lobes to a side — enough to enclose the body, few enough to stay cloud
  [66, 148, 56], [90, 210, 52],
  [334, 148, 56], [310, 206, 52],
  // bottom: longer and flatter than the top, as a cloud's underside is
  [134, 224, 60], [222, 234, 68]
]

/**
 * Content sits in `px-[15%] pb-[15%] pt-[12%]` — percentages on BOTH axes,
 * because CSS resolves padding-block against the width too, so the lobes and
 * the inset grow together and the padding stays valid at any aspect ratio the
 * stretch produces.
 *
 * The paint lives in `<CloudDefs />` and the shadow in `.cloud-card`, so two
 * cards on one page do not each mint a duplicate gradient id, and a caller can
 * override the shadow from CSS (a hover state on an inline `filter` cannot be
 * reached from a stylesheet).
 */
export function CloudCard({
  tone = "day",
  className = ""
}: {
  tone?: "day" | "storm"
  className?: string
}) {
  return (
    /* The viewBox is the site's 400x300 opened out top and bottom: the crown
       reaches y=-14 and the underside y=302, and a root <svg> clips both to a
       flat edge. */
    <svg
      viewBox="0 -16 400 332"
      preserveAspectRatio="none"
      className={`cloud-card absolute inset-0 h-full w-full ${className}`}
      aria-hidden
      focusable="false">
      <g
        fill={`url(#ext-card-paint${tone === "storm" ? "-storm" : ""})`}
        filter="url(#ext-cloudy)">
        <rect x={CARD_BODY.x} y={CARD_BODY.y} width={CARD_BODY.w} height={CARD_BODY.h} />
        {CARD_PUFFS.map(([cx, cy, r], i) => (
          <circle key={i} cx={cx} cy={cy} r={r} />
        ))}
      </g>
    </svg>
  )
}

/**
 * A single static cloud, for something to sit on. Unlike the banks this one
 * does not tile or drift — it is a shape, not weather.
 */
export function StillCloud({
  className = "",
  style,
  shape = 0
}: {
  className?: string
  style?: React.CSSProperties
  shape?: number
}) {
  return (
    /* The viewBox has to contain the whole silhouette, not the 0..200 mound the
       band strips use. The puffs run from y=-18 (the tall centre lobe) to y=216
       (the bottom row), and a root <svg> clips: at 0 20 420 180 the bottom row
       is sheared off into a dead straight edge across the underside, which is
       the one thing that stops a cloud reading as a cloud. */
    <svg viewBox="0 -24 420 264" className={className} style={style} aria-hidden focusable="false">
      <defs>
        <filter
          id={`still-goo-${shape}`}
          x="-20%"
          y="-40%"
          width="140%"
          height="200%"
          colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="b" />
          <feColorMatrix in="b" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -8" result="goo" />
          <feGaussianBlur in="goo" stdDeviation="1.4" />
        </filter>
        <linearGradient id={`still-paint-${shape}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="216">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.96" />
          <stop offset="0.55" stopColor="#F1E5FF" stopOpacity="0.86" />
          <stop offset="1" stopColor="#DCC8F8" stopOpacity="0.62" />
        </linearGradient>
      </defs>
      <g fill={`url(#still-paint-${shape})`} filter={`url(#still-goo-${shape})`}>
        {CLOUD_SHAPES[shape].map((p, i) => (
          <circle key={i} cx={p.cx} cy={p.cy} r={p.r} />
        ))}
      </g>
    </svg>
  )
}

/**
 * CSS-only snow. Each layer is a repeating tile of flakes that moves down by
 * exactly one tile per loop, so the loop has no visible seam. Only `transform`
 * is animated, with literal values (custom properties in keyframes can stop the
 * browser running them off the main thread).
 *
 * Delivered as a style string because storefront routes ship partitioned
 * Tailwind stylesheets that would not include these rules on every page.
 */

interface SnowLayer {
  /** Tile edge in px; also the distance fallen per loop. */
  tile: number;
  /** Fall speed in px per second, independent of screen refresh rate. */
  speed: number;
  /** Sideways drift at mid-loop, in px. */
  sway: number;
  /** Flakes as [x, y, radius] within the tile. */
  flakes: ReadonlyArray<readonly [number, number, number]>;
}

export const SNOW_LAYERS: readonly SnowLayer[] = [
  {
    tile: 430,
    speed: 70,
    sway: 18,
    flakes: [
      [37, 64, 4],
      [212, 17, 3.5],
      [389, 141, 4],
      [118, 233, 3.5],
      [301, 322, 4],
      [64, 397, 3.5],
    ],
  },
  {
    tile: 330,
    speed: 50,
    sway: -14,
    flakes: [
      [21, 187, 2.5],
      [97, 41, 3],
      [163, 262, 2.5],
      [208, 113, 2],
      [279, 219, 3],
      [301, 18, 2],
      [58, 311, 2.5],
    ],
  },
  {
    tile: 270,
    speed: 35,
    sway: 10,
    flakes: [
      [14, 31, 1.5],
      [89, 148, 2],
      [143, 67, 1.5],
      [231, 193, 2],
      [187, 251, 1.5],
      [52, 222, 1.5],
    ],
  },
];

// Ice blue rather than pure white, so flakes show on white page areas too.
const FLAKE_COLOR = 'rgb(148 190 232 / 0.9)';

function layerCss(
  { tile, speed, sway, flakes }: SnowLayer,
  index: number
): string {
  const images = flakes
    .map(
      ([x, y, r]) =>
        `radial-gradient(circle at ${x}px ${y}px, ${FLAKE_COLOR} ${r}px, transparent ${r + 1}px)`
    )
    .join(',');
  const duration = (tile / speed).toFixed(2);

  return `
.oga-snow-layer-${index}{top:-${tile}px;background-image:${images};background-size:${tile}px ${tile}px;animation:oga-snow-fall-${index} ${duration}s linear infinite}
@keyframes oga-snow-fall-${index}{0%{transform:translate3d(0,0,0)}50%{transform:translate3d(${sway}px,${tile / 2}px,0)}100%{transform:translate3d(0,${tile}px,0)}}`;
}

export const SNOW_CSS = `
.oga-snow{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:100}
.oga-snow-layer{position:absolute;left:-20px;right:-20px;bottom:0;will-change:transform}
.oga-snow-lights{position:absolute;top:0;left:0;right:0;height:4px;filter:blur(4px);background:linear-gradient(to right,rgb(239 68 68 / 0.2),rgb(34 197 94 / 0.2),rgb(239 68 68 / 0.2))}
.oga-snow-stop{position:fixed;left:12px;bottom:calc(env(safe-area-inset-bottom, 0px) + 168px);z-index:60;min-height:32px;padding:6px 12px;border:1px solid rgb(255 255 255 / 0.25);border-radius:999px;background:rgb(17 24 39 / 0.85);color:#fff;font-size:12px;line-height:1;cursor:pointer}
@media (min-width: 768px){.oga-snow-stop{bottom:16px}}
@media (prefers-reduced-motion: reduce){.oga-snow,.oga-snow-stop{display:none}}
${SNOW_LAYERS.map(layerCss).join('')}
`;

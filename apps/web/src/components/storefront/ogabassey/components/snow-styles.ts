/**
 * CSS-only snow. Each layer is a repeating tile of flakes that moves down by
 * exactly one tile per loop, so the loop has no visible seam. Only `transform`
 * is animated, with literal values (custom properties in keyframes can stop the
 * browser running them off the main thread).
 *
 * Delivered as a style string because storefront routes ship partitioned
 * Tailwind stylesheets that would not include these rules on every page.
 *
 * Stacking: above page content and sticky bars (z 40), below every storefront
 * modal and drawer (z 50 and up), so snow never falls over an open overlay.
 */

import { SNOW_LAYERS, type SnowLayer } from './snow-layers';

// Seasonal artwork, not branding: snow keeps its own colour on every theme.
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
.oga-snow{position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:45}
.oga-snow-layer{position:absolute;left:-20px;right:-20px;bottom:0;will-change:transform}
.oga-snow-lights{position:absolute;top:0;left:0;right:0;height:4px;filter:blur(4px);background:linear-gradient(to right,var(--store-primary),var(--store-accent),var(--store-primary));opacity:0.25}
.oga-snow-stop{position:fixed;left:12px;bottom:calc(env(safe-area-inset-bottom, 0px) + 168px);z-index:46;min-height:32px;padding:6px 12px;border:1px solid var(--store-primary-text);border-radius:999px;background:var(--store-primary);color:var(--store-primary-text);font-size:12px;line-height:1;cursor:pointer}
@media (min-width: 768px){.oga-snow-stop{bottom:16px}}
@media (prefers-reduced-motion: reduce){.oga-snow,.oga-snow-stop{display:none}}
${SNOW_LAYERS.map(layerCss).join('')}
`;

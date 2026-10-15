import 'server-only';
import { useId } from 'react';
import type { ProjectedCssHero } from './css-hero-adapter';

// Lab twin of the builder CSS-background hero: one layer per breakpoint,
// each selecting between the staged AVIF and WebP tiers. Breakpoint images
// load ONLY inside their media query: a scoped <style> block gates every
// layer, so viewports download exactly the tiers they render (inline
// background-images would fetch every breakpoint at every viewport).
//
// Lab-only: only the flag-gated lab route renders these mounts. They
// perform no I/O, read no tenant state, and touch no production
// component, guard, shell, or global image configuration.
const CSS_MEDIA_PATTERN = /^[\w\s().,/:*+-]+$/;

export function PilotLabCssHeroMount({
  projection,
}: {
  projection: ProjectedCssHero;
}): React.JSX.Element {
  const scope = `plab-css-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  for (const breakpoint of projection.breakpoints) {
    if (!CSS_MEDIA_PATTERN.test(breakpoint.media)) {
      throw new Error(
        `merchant image pilot: refusing to emit unscoped CSS media "${breakpoint.media}"`
      );
    }
  }
  const rules = projection.breakpoints
    .map((breakpoint, index) => {
      // Format-honest control: identical URLs mean one original file, so a
      // typed image-set would gate undecodable bytes behind AVIF/WebP
      // claims. Emit the plain url() alone instead.
      const image =
        breakpoint.avifUrl === breakpoint.webpUrl
          ? `background-image:url("${breakpoint.webpUrl}");`
          : `background-image:url("${breakpoint.webpUrl}");background-image:image-set(url("${breakpoint.avifUrl}") type("image/avif"),url("${breakpoint.webpUrl}") type("image/webp"));`;
      return `@media ${breakpoint.media}{.${scope} .plab-css-layer-${index}{${image}background-size:${projection.cover ? 'cover' : 'auto'};}}`;
    })
    .join('');
  return (
    <div data-pilot-lab-css-hero="true" className={scope}>
      <style>{rules}</style>
      {projection.breakpoints.map((breakpoint, index) => (
        <div
          key={breakpoint.media}
          data-pilot-lab-css-layer={breakpoint.media}
          className={`plab-css-layer-${index}`}
        />
      ))}
    </div>
  );
}

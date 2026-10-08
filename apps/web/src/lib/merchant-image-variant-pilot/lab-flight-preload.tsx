import 'server-only';
import { preload } from 'react-dom';
import type { ProjectedOgabasseyMobile } from './ogabassey-mobile-adapter';

// Flight-preload owner: the same react-dom channel the production hero
// hints use, fed by the frozen projection instead of a CDN URL. `type`
// defaults to the projection's AVIF gate; pass null for format-agnostic
// bytes (the store control hero, whose derived srcSet serves the original).
//
// Lab-only: only the flag-gated lab route renders these mounts. They
// perform no I/O, read no tenant state, and touch no production
// component, guard, shell, or global image configuration.
export function PilotLabFlightPreload({
  projection,
  type,
}: {
  projection: ProjectedOgabasseyMobile;
  type?: string | null;
}): null {
  preload(projection.preload.href, {
    as: 'image',
    fetchPriority: projection.preload.fetchPriority,
    imageSizes: projection.preload.imageSizes,
    imageSrcSet: projection.preload.imageSrcSet,
    media: projection.preload.media,
    type: type === undefined ? projection.preload.type : (type ?? undefined),
  });
  return null;
}

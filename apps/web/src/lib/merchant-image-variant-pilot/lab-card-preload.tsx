import 'server-only';
import { preload } from 'react-dom';
import type { ProjectedPilotImage } from './next-image-adapter';

// Priority-card preload owner: flight-only, like the production card it
// mirrors (next/image's `preload` prop hoists exactly one head link — no
// scanner twin). AVIF-only typed srcSet; WebP is discovered from markup by
// non-AVIF browsers, so preloading both formats can never double-fetch.
// Rendered by the store page (server), never by the client card clone.
//
// Lab-only: only the flag-gated lab route renders these mounts. They
// perform no I/O, read no tenant state, and touch no production
// component, guard, shell, or global image configuration.
export function PilotLabCardPreload({
  projection,
}: {
  projection: ProjectedPilotImage;
}): null {
  const avif = projection.sources.find((source) => source.format === 'avif');
  if (!avif) {
    preload(projection.fallbackSrc, {
      as: 'image',
      fetchPriority: 'high',
      imageSizes: projection.sizes,
    });
    return null;
  }
  // buildPilotSrcSet sorts ascending, so the first candidate is the
  // smallest tier — the href fallback for prefetch-only consumers.
  const href = avif.srcSet.split(',')[0]?.split(' ')[0] ?? '';
  preload(href, {
    as: 'image',
    fetchPriority: 'high',
    imageSizes: projection.sizes,
    imageSrcSet: avif.srcSet,
    type: 'image/avif',
  });
  return null;
}

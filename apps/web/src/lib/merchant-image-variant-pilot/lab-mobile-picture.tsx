import 'server-only';
import type { PilotLabArm } from './lab-arm';
import type { ProjectedOgabasseyMobile } from './ogabassey-mobile-adapter';

// Rendered-picture owner: same structure as the mounted mobile hero picture
// (AVIF source, fallback source, transparent-pixel img). `type` defaults
// to the AVIF gate; pass null for format-agnostic bytes (the control arm
// serves the original in every candidate, so a type gate would lie).
//
// Lab-only: only the flag-gated lab route renders these mounts. They
// perform no I/O, read no tenant state, and touch no production
// component, guard, shell, or global image configuration.
export function PilotLabMobilePicture({
  arm,
  projection,
  type,
}: {
  arm: PilotLabArm;
  projection: ProjectedOgabasseyMobile;
  type?: string | null;
}): React.JSX.Element {
  return (
    <picture data-pilot-lab-picture={arm}>
      <source
        media={projection.media}
        sizes={projection.sizes}
        srcSet={projection.avifSrcSet}
        type={type === undefined ? 'image/avif' : (type ?? undefined)}
      />
      <source
        media={projection.media}
        sizes={projection.sizes}
        srcSet={projection.fallbackSrcSet}
      />
      <img
        alt={projection.alt}
        decoding="sync"
        fetchPriority="high"
        loading="eager"
        src={projection.imgSrc}
        className={`h-full w-full ${
          projection.imageFit === 'contain'
            ? 'object-contain object-right'
            : 'object-cover'
        }`}
      />
    </picture>
  );
}

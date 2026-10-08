import 'server-only';
import type { PilotLabArm } from './lab-arm';
import type { ProjectedPilotImage } from './next-image-adapter';

// Generic next/image-slot mount: one <picture> with a <source> per projected
// format over the shared slot sizes.
//
// Lab-only: only the flag-gated lab route renders these mounts. They
// perform no I/O, read no tenant state, and touch no production
// component, guard, shell, or global image configuration.
export function PilotLabPictureMount({
  arm,
  projection,
}: {
  arm: PilotLabArm;
  projection: ProjectedPilotImage;
}): React.JSX.Element {
  return (
    <picture data-pilot-lab-picture={arm}>
      {projection.sources.map((source) => (
        <source
          key={source.format}
          sizes={projection.sizes}
          srcSet={source.srcSet}
          type={`image/${source.format}`}
        />
      ))}
      <img
        alt={projection.alt}
        decoding="async"
        fetchPriority={projection.fetchPriority}
        height={projection.height}
        loading={projection.loading}
        sizes={projection.sizes}
        src={projection.fallbackSrc}
        width={projection.width}
      />
    </picture>
  );
}

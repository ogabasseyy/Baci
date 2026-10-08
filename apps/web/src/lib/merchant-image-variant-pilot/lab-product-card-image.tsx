'use client';

import { useState } from 'react';
import type { ProjectedPilotImage } from './next-image-adapter';

export function LabProductCardImage({
  imageHint,
  placeholder,
  projection,
}: {
  imageHint: string;
  placeholder: string;
  projection: ProjectedPilotImage;
}) {
  // Immediate paint parity with the control's next/image blur placeholder
  // (data URL, zero requests); removed on decode like the framework's.
  const [loaded, setLoaded] = useState(false);
  const style = loaded
    ? undefined
    : { backgroundImage: `url("${placeholder}")`, backgroundSize: 'cover' };
  const clearOnDecoded = (image: HTMLImageElement): void => {
    const decoded = image.decode ? image.decode() : Promise.resolve();
    void decoded
      .catch(() => {
        // Match Next Image: load succeeded even if decode rejects.
      })
      .then(() => {
        if (image.parentElement && image.isConnected) setLoaded(true);
      });
  };
  return (
    <picture data-pilot-lab-card-image="true" style={style}>
      {projection.sources.map((source) => (
        <source
          key={source.format}
          sizes={projection.sizes}
          srcSet={source.srcSet}
          type={`image/${source.format}`}
        />
      ))}
      <img
        src={projection.fallbackSrc}
        alt={projection.alt}
        data-ai-hint={imageHint}
        width={projection.width}
        height={projection.height}
        sizes={projection.sizes}
        loading={projection.loading}
        fetchPriority={projection.fetchPriority}
        decoding="async"
        className="object-cover w-full h-auto aspect-video"
        ref={(image) => {
          // A manually preloaded candidate can finish before hydration
          // attaches onLoad; the lost event would leave the blur behind
          // the decoded image (visible through transparent pixels),
          // diverging the pilot arm from the control. An
          // already-complete image clears through the same decode path.
          if (image?.complete && image.naturalWidth > 0) {
            clearOnDecoded(image);
          }
        }}
        onLoad={(event) => {
          clearOnDecoded(event.currentTarget);
        }}
      />
    </picture>
  );
}

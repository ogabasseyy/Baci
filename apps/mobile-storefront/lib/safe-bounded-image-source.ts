import { createBoundedImageSource } from './bounded-image-source';
import { resolveSafeImageUri } from './safe-image-uri';

/**
 * Build the physical decode dimensions and apply the managed-CDN format guard
 * in one step for catalog surfaces.
 */
export function createSafeBoundedImageSource(options: {
  height: number;
  fit?: 'inside' | 'cover';
  pixelRatio?: number;
  uri: string;
  width: number;
}) {
  const boundedSource = createBoundedImageSource(options);

  return {
    ...boundedSource,
    uri: resolveSafeImageUri(boundedSource.uri, {
      ...boundedSource,
      ...(options.fit ? { fit: options.fit } : {}),
    }),
  };
}

/** Safe hero image-source builder. */
import { createSafeBoundedImageSource } from '@/lib/safe-bounded-image-source';

export type HeroImageFit = 'inside' | 'cover';

export function getHeroImageSource(
  uri: string,
  width: number,
  height: number,
  fit: HeroImageFit = 'inside'
) {
  // 'inside' is the downstream default: only 'cover' changes the resolved
  // URI, so omit the key otherwise to keep the call shape stable.
  return createSafeBoundedImageSource(
    fit === 'cover' ? { fit, height, uri, width } : { height, uri, width }
  );
}

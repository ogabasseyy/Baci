import { toOgabasseySameOriginTransformUrl } from '@/lib/ogabassey-same-origin-hero-url';

/**
 * Rewrites every candidate URL in a responsive `srcset` string to its
 * same-origin `/cdn-image/...` path while preserving width/density descriptors.
 */
export function toOgabasseySameOriginSrcSet(
  srcSet: string | null | undefined
): string | null | undefined {
  if (!srcSet) {
    return srcSet;
  }
  return srcSet
    .split(/,\s+/)
    .map((candidate) => {
      const trimmed = candidate.trim();
      if (!trimmed) {
        return trimmed;
      }
      const [candidateUrl, ...descriptors] = trimmed.split(/\s+/);
      return [
        toOgabasseySameOriginTransformUrl(candidateUrl),
        ...descriptors,
      ].join(' ');
    })
    .join(', ');
}

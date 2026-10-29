import { toOgabasseySameOriginTransformUrl } from '@/lib/ogabassey-same-origin-hero-url';

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

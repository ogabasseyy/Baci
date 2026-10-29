import { DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import type { OgabasseyCdnImageProxyRequest } from '@/schemas/ogabassey-cdn-image-proxy';
import { ogabasseyCdnImageProxySearchParamsSchema } from '@/schemas/ogabassey-cdn-image-query';

export function buildUpstreamOgabasseyTransformUrl(
  options: OgabasseyCdnImageProxyRequest['options'],
  assetPath: string,
  overrideQuality?: number,
  searchParams?: URLSearchParams
): string {
  const parts = [`width=${options.width}`];
  if (options.height !== undefined) {
    parts.push(`height=${options.height}`);
  }
  parts.push(`quality=${overrideQuality ?? options.quality}`);
  parts.push(`format=${options.format}`);
  if (options.fit === 'cover') {
    parts.push('fit=cover');
  }
  const encodedAssetPath = assetPath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const parsedQuery = ogabasseyCdnImageProxySearchParamsSchema.safeParse(
    searchParams?.has('v') ? { v: searchParams.get('v') ?? undefined } : {}
  );
  const query =
    parsedQuery.success && parsedQuery.data.v
      ? `?v=${encodeURIComponent(parsedQuery.data.v)}`
      : '';
  return `${DEFAULT_MEDIA_CDN_ORIGIN}/image/${parts.join(',')}/${encodedAssetPath}${query}`;
}

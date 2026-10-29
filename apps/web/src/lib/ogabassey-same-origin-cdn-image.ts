import { NextResponse } from 'next/server';
import {
  MOBILE_HERO_LCP_MAX_BYTES,
  MOBILE_HERO_MIN_SRCSET_WIDTH,
  MOBILE_HERO_QUALITY_STEPS,
} from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { DEFAULT_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import type { OgabasseyCdnImageProxyRequest } from '@/schemas/ogabassey-cdn-image-proxy';

const IMMUTABLE_IMAGE_CACHE_CONTROL =
  'public, max-age=31536000, s-maxage=31536000, immutable';
const SHORT_ERROR_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';

const MIME_BY_FORMAT: Record<
  OgabasseyCdnImageProxyRequest['options']['format'],
  string
> = {
  avif: 'image/avif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function buildUpstreamOgabasseyTransformUrl(
  options: OgabasseyCdnImageProxyRequest['options'],
  assetPath: string,
  overrideQuality?: number
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
  return `${DEFAULT_MEDIA_CDN_ORIGIN}/image/${parts.join(',')}/${assetPath}`;
}

export function getCandidateQualitiesForRequest(
  options: OgabasseyCdnImageProxyRequest['options']
): readonly number[] {
  if (
    options.format === 'avif' &&
    options.width <= MOBILE_HERO_MIN_SRCSET_WIDTH
  ) {
    const stepsBelowOrEqual = MOBILE_HERO_QUALITY_STEPS.filter(
      (step) => step <= options.quality
    );
    return stepsBelowOrEqual.length > 0 ? stepsBelowOrEqual : [options.quality];
  }
  return [options.quality];
}

export async function fetchSameOriginOgabasseyImageResponse(
  parsed: OgabasseyCdnImageProxyRequest,
  fetcher: typeof fetch = fetch
): Promise<Response> {
  const qualities = getCandidateQualitiesForRequest(parsed.options);
  const enforceByteCap = qualities.length > 1;
  let lastBytes: ArrayBuffer | null = null;
  let lastContentType = MIME_BY_FORMAT[parsed.options.format];
  let effectiveQuality = parsed.options.quality;

  for (const quality of qualities) {
    const upstreamUrl = buildUpstreamOgabasseyTransformUrl(
      parsed.options,
      parsed.assetPath,
      quality
    );
    let response: Response;
    try {
      response = await fetcher(upstreamUrl);
    } catch {
      return NextResponse.json(
        { error: 'Upstream image service unavailable' },
        {
          headers: { 'Cache-Control': SHORT_ERROR_CACHE_CONTROL },
          status: 502,
        }
      );
    }

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Requested image variant not found' },
        {
          headers: { 'Cache-Control': SHORT_ERROR_CACHE_CONTROL },
          status: response.status === 404 ? 404 : 502,
        }
      );
    }

    const buffer = await response.arrayBuffer();
    lastBytes = buffer;
    lastContentType =
      response.headers.get('content-type') ||
      MIME_BY_FORMAT[parsed.options.format];
    effectiveQuality = quality;

    if (!enforceByteCap || buffer.byteLength <= MOBILE_HERO_LCP_MAX_BYTES) {
      break;
    }
  }

  if (!lastBytes) {
    return NextResponse.json(
      { error: 'Unable to resolve image payload' },
      { status: 502 }
    );
  }

  return new Response(lastBytes, {
    headers: {
      'Cache-Control': IMMUTABLE_IMAGE_CACHE_CONTROL,
      'CDN-Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(lastBytes.byteLength),
      'Content-Type': lastContentType,
      'X-Hero-Effective-Quality': String(effectiveQuality),
    },
    status: 200,
  });
}

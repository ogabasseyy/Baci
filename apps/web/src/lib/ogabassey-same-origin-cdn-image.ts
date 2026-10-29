import { NextResponse } from 'next/server';
import {
  MOBILE_HERO_LCP_MAX_BYTES,
  MOBILE_HERO_MIN_SRCSET_WIDTH,
  MOBILE_HERO_QUALITY_STEPS,
  selectHeroAvifQualityForByteCap,
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
  const query = searchParams?.toString();
  return `${DEFAULT_MEDIA_CDN_ORIGIN}/image/${parts.join(',')}/${assetPath}${query ? `?${query}` : ''}`;
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

function buildErrorResponse(message: string, status: 404 | 502): Response {
  return NextResponse.json(
    { error: message },
    {
      headers: { 'Cache-Control': SHORT_ERROR_CACHE_CONTROL },
      status,
    }
  );
}

export async function fetchSameOriginOgabasseyImageResponse(
  parsed: OgabasseyCdnImageProxyRequest,
  fetcher: typeof fetch = fetch,
  searchParams?: URLSearchParams
): Promise<Response> {
  const qualities = getCandidateQualitiesForRequest(parsed.options);
  const enforceByteCap = qualities.length > 1;
  const fallbackContentType = MIME_BY_FORMAT[parsed.options.format];

  if (!enforceByteCap) {
    const quality = qualities[0] ?? parsed.options.quality;
    const upstreamUrl = buildUpstreamOgabasseyTransformUrl(
      parsed.options,
      parsed.assetPath,
      quality,
      searchParams
    );
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetcher(upstreamUrl);
    } catch {
      return buildErrorResponse('Upstream image service unavailable', 502);
    }

    if (!upstreamResponse.ok) {
      return buildErrorResponse(
        'Requested image variant not found',
        upstreamResponse.status === 404 ? 404 : 502
      );
    }

    const headers = new Headers({
      'Cache-Control': IMMUTABLE_IMAGE_CACHE_CONTROL,
      'CDN-Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Type':
        upstreamResponse.headers.get('content-type') || fallbackContentType,
      'X-Hero-Effective-Quality': String(quality),
    });
    const upstreamLength = upstreamResponse.headers.get('content-length');
    if (upstreamLength) {
      headers.set('Content-Length', upstreamLength);
    }

    return new Response(upstreamResponse.body, {
      headers,
      status: 200,
    });
  }

  const settled = await Promise.all(
    qualities.map(async (quality) => {
      const upstreamUrl = buildUpstreamOgabasseyTransformUrl(
        parsed.options,
        parsed.assetPath,
        quality,
        searchParams
      );
      try {
        const response = await fetcher(upstreamUrl);
        if (!response.ok) {
          return {
            ok: false as const,
            status: response.status === 404 ? (404 as const) : (502 as const),
          };
        }
        const buffer = await response.arrayBuffer();
        return {
          buffer,
          bytes: buffer.byteLength,
          contentType:
            response.headers.get('content-type') || fallbackContentType,
          ok: true as const,
          quality,
        };
      } catch {
        return {
          ok: false as const,
          status: 502 as const,
        };
      }
    })
  );

  const candidates = settled.filter((item) => item.ok);
  if (candidates.length === 0) {
    const failed = settled.find((item) => !item.ok);
    return buildErrorResponse(
      'Requested image variant not found',
      failed && !failed.ok ? failed.status : 502
    );
  }

  const selectedMeta = selectHeroAvifQualityForByteCap(
    candidates,
    MOBILE_HERO_LCP_MAX_BYTES
  );
  const selected =
    candidates.find((item) => item.quality === selectedMeta?.quality) ??
    candidates[candidates.length - 1];

  if (!selected) {
    return buildErrorResponse('Unable to resolve image payload', 502);
  }

  return new Response(selected.buffer, {
    headers: {
      'Cache-Control': IMMUTABLE_IMAGE_CACHE_CONTROL,
      'CDN-Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(selected.bytes),
      'Content-Type': selected.contentType,
      'X-Hero-Effective-Quality': String(selected.quality),
    },
    status: 200,
  });
}

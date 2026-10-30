import { NextResponse } from 'next/server';
import { MOBILE_HERO_LCP_MAX_BYTES } from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { selectHeroAvifQualityForByteCap } from '@/components/storefront/ogabassey/components/select-hero-avif-quality-for-byte-cap';
import { buildUpstreamOgabasseyTransformUrl } from '@/lib/build-upstream-ogabassey-transform-url';
import { getCandidateQualitiesForRequest } from '@/lib/get-candidate-qualities-for-request';
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

function buildErrorResponse(message: string, status: 404 | 502): Response {
  return NextResponse.json(
    { error: message },
    {
      headers: { 'Cache-Control': SHORT_ERROR_CACHE_CONTROL },
      status,
    }
  );
}

interface CandidateSuccess {
  buffer: ArrayBuffer;
  bytes: number;
  contentType: string;
  ok: true;
  quality: number;
}

interface CandidateFailure {
  ok: false;
  status: 404 | 502;
}

type CandidateOutcome = CandidateFailure | CandidateSuccess;

async function fetchCandidateVariant(
  parsed: OgabasseyCdnImageProxyRequest,
  fetcher: typeof fetch,
  quality: number,
  fallbackContentType: string,
  searchParams?: URLSearchParams,
  signal?: AbortSignal
): Promise<CandidateOutcome> {
  const upstreamUrl = buildUpstreamOgabasseyTransformUrl(
    parsed.options,
    parsed.assetPath,
    quality,
    searchParams
  );
  try {
    const response = await fetcher(upstreamUrl, { signal });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status === 404 ? 404 : 502,
      };
    }
    const buffer = await response.arrayBuffer();
    return {
      buffer,
      bytes: buffer.byteLength,
      contentType: response.headers.get('content-type') || fallbackContentType,
      ok: true,
      quality,
    };
  } catch {
    return {
      ok: false,
      status: 502,
    };
  }
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

  // Start candidate quality requests concurrently so lower qualities are
  // already in flight if quality=70 exceeds the 20 KB cap, but inspect them in
  // descending quality order and return immediately as soon as a fitting
  // candidate resolves without awaiting slower lower-quality variants.
  const controller = new AbortController();
  const candidatePromises = qualities.map((quality) =>
    fetchCandidateVariant(
      parsed,
      fetcher,
      quality,
      fallbackContentType,
      searchParams,
      controller.signal
    )
  );

  const candidates: CandidateSuccess[] = [];
  let failureStatus: 404 | 502 = 502;

  for (const candidatePromise of candidatePromises) {
    const outcome = await candidatePromise;
    if (!outcome.ok) {
      if (outcome.status === 404) {
        failureStatus = 404;
      }
      continue;
    }
    candidates.push(outcome);
    if (outcome.bytes <= MOBILE_HERO_LCP_MAX_BYTES) {
      break;
    }
  }

  controller.abort();

  if (candidates.length === 0) {
    return buildErrorResponse(
      'Requested image variant not found',
      failureStatus
    );
  }

  const selectedMeta = selectHeroAvifQualityForByteCap(
    candidates,
    MOBILE_HERO_LCP_MAX_BYTES
  );
  const selected =
    candidates.find((item) => item.quality === selectedMeta?.quality) ??
    candidates[candidates.length - 1];

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

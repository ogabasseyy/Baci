import { NextResponse } from 'next/server';
import { MOBILE_HERO_LCP_MAX_BYTES } from '@/components/storefront/ogabassey/components/hero-mobile-image-config';
import { selectHeroAvifQualityForByteCap } from '@/components/storefront/ogabassey/components/select-hero-avif-quality-for-byte-cap';
import { buildUpstreamOgabasseyTransformUrl } from '@/lib/build-upstream-ogabassey-transform-url';
import { getCandidateQualitiesForRequest } from '@/lib/get-candidate-qualities-for-request';
import type { OgabasseyCdnImageProxyRequest } from '@/schemas/ogabassey-cdn-image-proxy';

const IMMUTABLE_IMAGE_CACHE_CONTROL =
  'public, max-age=31536000, s-maxage=31536000, immutable';
const SHORT_ERROR_CACHE_CONTROL = 'public, max-age=60, s-maxage=60';
const UPSTREAM_TIMEOUT_MS = 5_000;

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

/**
 * Builds a short-cached JSON error response for missing or unavailable upstream
 * image variants.
 */
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

/**
 * Fetches a single upstream quality variant with a bounded timeout combined
 * with any caller-provided abort signal.
 */
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
    const timeoutSignal = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS);
    const response = await fetcher(upstreamUrl, {
      signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
    });
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

/**
 * Proxies an OgaBassey CDN image request on the storefront's own origin,
 * streaming uncapped variants directly and evaluating the descending quality
 * ladder (`70 -> 60 -> 50`) for `<= 384w` AVIF requests to target a best-effort
 * 20 KB byte cap (falling back to the lowest-quality successful candidate if
 * every rung exceeds 20,000 bytes).
 */
export async function fetchSameOriginOgabasseyImageResponse(
  parsed: OgabasseyCdnImageProxyRequest,
  fetcher: typeof fetch = fetch,
  searchParams?: URLSearchParams
): Promise<Response> {
  const qualities = getCandidateQualitiesForRequest(parsed.options);
  const useQualityStepDown = qualities.length > 1;
  const fallbackContentType = MIME_BY_FORMAT[parsed.options.format];

  if (!useQualityStepDown) {
    const quality = qualities[0] ?? parsed.options.quality;
    const upstreamUrl = buildUpstreamOgabasseyTransformUrl(
      parsed.options,
      parsed.assetPath,
      quality,
      searchParams
    );
    const headerTimeoutController = new AbortController();
    const headerTimeoutId = setTimeout(() => {
      headerTimeoutController.abort(
        new DOMException('Upstream header timeout', 'TimeoutError')
      );
    }, UPSTREAM_TIMEOUT_MS);
    let upstreamResponse: Response;
    try {
      upstreamResponse = await fetcher(upstreamUrl, {
        signal: headerTimeoutController.signal,
      });
    } catch {
      return buildErrorResponse('Upstream image service unavailable', 502);
    } finally {
      clearTimeout(headerTimeoutId);
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
  let hadTransientCandidateFailure = false;

  for (const candidatePromise of candidatePromises) {
    const outcome = await candidatePromise;
    if (!outcome.ok) {
      if (outcome.status === 404) {
        failureStatus = 404;
      } else {
        hadTransientCandidateFailure = true;
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
      'Cache-Control': hadTransientCandidateFailure
        ? SHORT_ERROR_CACHE_CONTROL
        : IMMUTABLE_IMAGE_CACHE_CONTROL,
      'CDN-Cache-Control': hadTransientCandidateFailure
        ? 'public, max-age=60'
        : 'public, max-age=31536000, immutable',
      'Content-Length': String(selected.bytes),
      'Content-Type': selected.contentType,
      'X-Hero-Effective-Quality': String(selected.quality),
    },
    status: 200,
  });
}

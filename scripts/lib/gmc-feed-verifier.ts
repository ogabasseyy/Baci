/**
 * GMC feed image verification I/O.
 *
 * CDN filesystem checks and HTTP probes for the backfill script.
 * This module is Node.js-only (fs, fetch) and runs exclusively on the VPS.
 */

import { existsSync } from 'node:fs';
import {
  type DestinationLookupFn,
  resolvePinnedDestination,
} from './remote-destination-gate';
// Relative path: scripts/ has no tsconfig and runs via `npx tsx` outside the
// workspace package graph, so `@baci/shared/gmc-feed` won't resolve here.
import {
  type ClassifiedImage,
} from '../../packages/shared/src/gmc-feed/index';
import { verifyCdnImage } from './cdn-image-verifier';

export interface VerificationResult {
  status:
    | 'verified'
    | 'missing'
    | 'invalid'
    | 'pending_derivative'
    | 'pending_verification';
  verified_url: string | null;
  verified_format: string | null;
  failure_reason: string | null;
}

const CDN_HOST = process.env.CDN_HOST || 'cdn.ogabassey.com';

const CONTENT_TYPE_TO_FORMAT: Record<string, string> = {
  'image/jpeg': 'jpeg',
  'image/jpg': 'jpeg',
  'image/png': 'png',
  'image/webp': 'webp',
};


/** Single-overload fetch signature for easy mock injection. */
export type FetchFn = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export function buildCdnTransformImageUrl(
  sourceUrl: string,
  format: 'jpeg' | 'webp' = 'jpeg'
): string | null {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }

  if (url.hostname !== CDN_HOST) return null;

  return `${url.origin}/image/width=1200,quality=90,format=${format}${url.pathname}${url.search}${url.hash}`;
}

export function getClassifiedImageVerificationUrl(
  classified: Pick<ClassifiedImage, 'source_url' | 'status' | 'verified_url'>
): string {
  if (
    classified.status === 'pending_derivative' &&
    isCdnUrl(classified.source_url)
  ) {
    return classified.source_url;
  }

  return classified.verified_url || classified.source_url;
}

/**
 * Verify a remote image URL via HTTP HEAD (with GET fallback on 405).
 *
 * The fetch runs on a dispatcher pinned to the validated address, so the
 * transport cannot re-resolve the hostname to a different destination.
 *
 * @param fetchFn Injectable for testing — defaults to global `fetch`
 * @param lookupFn Injectable DNS resolver, forwarded to the destination gate
 */
export async function verifyRemoteImage(
  url: string,
  fetchFn: FetchFn = globalThis.fetch,
  lookupFn?: DestinationLookupFn
): Promise<VerificationResult> {
  const gate = await resolvePinnedDestination(url, lookupFn);
  if ('failure' in gate) {
    return {
      status: gate.retryable ? 'pending_verification' : 'invalid',
      verified_url: null,
      verified_format: null,
      failure_reason: gate.failure,
    };
  }
  const { dispatcher } = gate;
  try {
    let response = await fetchFn(url, {
      method: 'HEAD',
      redirect: 'manual',
      dispatcher,
      signal: AbortSignal.timeout(10_000),
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        status: 'invalid',
        verified_url: null,
        verified_format: null,
        failure_reason: `Redirect rejected for ${url}`,
      };
    }

    // Fallback to GET if server doesn't support HEAD
    if (response.status === 405) {
      response = await fetchFn(url, {
        method: 'GET',
        redirect: 'manual',
        dispatcher,
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status >= 300 && response.status < 400) {
        return {
          status: 'invalid',
          verified_url: null,
          verified_format: null,
          failure_reason: `Redirect rejected for ${url}`,
        };
      }
      // Cancel body consumption since we only need status and headers
      await response.body?.cancel();
    }

    if (!response.ok) {
      const isTransient =
        response.status >= 500 ||
        response.status === 429;
      return {
        status: isTransient ? 'pending_verification' : 'missing',
        verified_url: null,
        verified_format: null,
        failure_reason: `HTTP ${response.status} for ${url}`,
      };
    }

    const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() || '';
    const format = CONTENT_TYPE_TO_FORMAT[contentType];

    if (!format) {
      return {
        status: 'invalid',
        verified_url: null,
        verified_format: null,
        failure_reason: `Non-feed-safe content-type: ${contentType} for ${url}`,
      };
    }

    return {
      status: 'verified',
      verified_url: url,
      verified_format: format,
      failure_reason: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 'pending_verification',
      verified_url: null,
      verified_format: null,
      failure_reason: `${message} for ${url}`,
    };
  } finally {
    // Release the pinned sockets on every path, including early returns.
    await dispatcher.close().catch(() => {});
  }
}

export async function verifyCdnImageWithTransformFallback(
  sourceUrl: string,
  cdnBasePath: string,
  fileExistsFn: (path: string) => boolean = existsSync,
  fetchFn: FetchFn = globalThis.fetch,
  lookupFn: DnsLookupFn = (hostname) => dnsLookup(hostname, { all: true })
): Promise<VerificationResult> {
  const localVerification = verifyCdnImage(
    sourceUrl,
    cdnBasePath,
    fileExistsFn
  );

  if (localVerification.status !== 'pending_derivative') {
    return localVerification;
  }

  const transformedUrl = buildCdnTransformImageUrl(sourceUrl, 'jpeg');
  if (!transformedUrl) return localVerification;

  const transformedVerification = await verifyRemoteImage(
    transformedUrl,
    fetchFn,
    lookupFn
  );

  if (
    transformedVerification.status === 'verified' &&
    transformedVerification.verified_format === 'jpeg'
  ) {
    return transformedVerification;
  }

  if (transformedVerification.status === 'pending_verification') {
    return transformedVerification;
  }

  return localVerification;
}

/**
 * Check if a URL is hosted on the CDN.
 */
export function isCdnUrl(url: string): boolean {
  try {
    return new URL(url).hostname === CDN_HOST;
  } catch {
    return false;
  }
}

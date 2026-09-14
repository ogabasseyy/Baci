/**
 * GMC feed image verification I/O.
 *
 * CDN filesystem checks and HTTP probes for the backfill script.
 * This module is Node.js-only (fs, fetch) and runs exclusively on the VPS.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
// Relative path: scripts/ has no tsconfig and runs via `npx tsx` outside the
// workspace package graph, so `@baci/shared/gmc-feed` won't resolve here.
import {
  type ClassifiedImage,
  getImageFormat,
  replaceAvifWithJpg,
} from '../../packages/shared/src/gmc-feed/index';
import { validateRemoteUrl } from './remote-url-policy';

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

/**
 * Verify a CDN-hosted image by checking the local filesystem.
 *
 * Maps `https://cdn.ogabassey.com/core-assets/...` to the local path
 * under `cdnBasePath`. For AVIF sources, checks if a sibling `.jpg`
 * derivative exists.
 *
 * @param fileExistsFn Injectable for testing — defaults to `fs.existsSync`
 */
export function verifyCdnImage(
  sourceUrl: string,
  cdnBasePath: string,
  fileExistsFn: (path: string) => boolean = existsSync
): VerificationResult {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return {
      status: 'invalid',
      verified_url: null,
      verified_format: null,
      failure_reason: `Invalid URL: ${sourceUrl}`,
    };
  }

  // Prevent path traversal
  const localPath = resolve(cdnBasePath, `.${url.pathname}`);
  if (!localPath.startsWith(resolve(cdnBasePath))) {
    return {
      status: 'invalid',
      verified_url: null,
      verified_format: null,
      failure_reason: `Path traversal detected: ${url.pathname}`,
    };
  }

  const format = getImageFormat(sourceUrl);

  // AVIF: check sibling .jpg derivative
  if (format === 'avif') {
    const jpgPath = localPath.replace(/\.avif$/i, '.jpg');
    const jpgUrl = replaceAvifWithJpg(sourceUrl);

    if (fileExistsFn(jpgPath)) {
      return {
        status: 'verified',
        verified_url: jpgUrl,
        verified_format: 'jpeg',
        failure_reason: null,
      };
    }
    return {
      status: 'pending_derivative',
      verified_url: jpgUrl,
      verified_format: 'jpeg',
      failure_reason: null,
    };
  }

  // JPG/PNG/WebP: check file exists
  if (fileExistsFn(localPath)) {
    return {
      status: 'verified',
      verified_url: sourceUrl,
      verified_format: format,
      failure_reason: null,
    };
  }

  return {
    status: 'missing',
    verified_url: null,
    verified_format: null,
    failure_reason: `File not found on CDN: ${url.pathname}`,
  };
}

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
 * @param fetchFn Injectable for testing — defaults to global `fetch`
 */
export async function verifyRemoteImage(
  url: string,
  fetchFn: FetchFn = globalThis.fetch
): Promise<VerificationResult> {
  if (!validateRemoteUrl(url)) {
    return {
      status: 'invalid',
      verified_url: null,
      verified_format: null,
      failure_reason: `Rejected remote image destination: ${url}`,
    };
  }
  try {
    let response = await fetchFn(url, {
      method: 'HEAD',
      redirect: 'manual',
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
  }
}

export async function verifyCdnImageWithTransformFallback(
  sourceUrl: string,
  cdnBasePath: string,
  fileExistsFn: (path: string) => boolean = existsSync,
  fetchFn: FetchFn = globalThis.fetch
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
    fetchFn
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

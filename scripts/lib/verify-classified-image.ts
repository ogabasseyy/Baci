/**
 * Classified-image verification orchestration for the feed backfill.
 *
 * Dispatches one classified candidate to the right verifier: invalid rows
 * short-circuit, CDN URLs go through the filesystem check with transform
 * fallback, and absolute HTTP(S) URLs go through the remote probe.
 */

// Relative path: scripts/ has no tsconfig and runs via `npx tsx` outside the
// workspace package graph, so `@baci/shared/gmc-feed` won't resolve here.
import type { ClassifiedImage } from '../../packages/shared/src/gmc-feed/index';
import {
  type VerificationResult,
  getClassifiedImageVerificationUrl,
  isCdnUrl,
  verifyCdnImageWithTransformFallback,
  verifyRemoteImage,
} from './gmc-feed-verifier';

export async function verifyClassifiedImage(
  classified: ClassifiedImage,
  cdnBasePath: string
): Promise<VerificationResult> {
  const url = getClassifiedImageVerificationUrl(classified);

  // Already invalid — no verification needed
  if (classified.status === 'invalid') {
    return {
      status: 'invalid',
      verified_url: null,
      verified_format: null,
      failure_reason: classified.failure_reason,
    };
  }

  // CDN-hosted: verify via filesystem
  if (isCdnUrl(url)) {
    return verifyCdnImageWithTransformFallback(url, cdnBasePath);
  }

  // Non-CDN absolute URL or absolutized relative path: verify via HTTP
  if (url.startsWith('http')) {
    return verifyRemoteImage(url);
  }

  return {
    status: 'invalid',
    verified_url: null,
    verified_format: null,
    failure_reason: `Cannot verify URL: ${url}`,
  };
}

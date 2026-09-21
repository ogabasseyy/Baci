/**
 * CDN-hosted image verification via the local filesystem.
 *
 * Maps CDN URLs to on-disk paths for the backfill script. This module is
 * Node.js-only (fs, path) and runs exclusively on the VPS. Single export
 * per the repository modularity boundary.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
// Relative path: scripts/ has no tsconfig and runs via `npx tsx` outside the
// workspace package graph, so `@baci/shared/gmc-feed` won't resolve here.
import {
  getImageFormat,
  replaceAvifWithJpg,
} from '../../packages/shared/src/gmc-feed/index';
import type { VerificationResult } from './gmc-feed-verifier';

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

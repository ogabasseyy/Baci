/**
 * Google Merchant Center feed image classification utilities.
 *
 * Pure functions for extracting and classifying image candidates
 * from product data. Used by the offline VPS backfill job to
 * populate the `product_feed_images` manifest table.
 *
 * @module @baci/shared/gmc-feed
 */

export interface BackfillImageCandidate {
  product_id: string;
  source_url: string;
  is_primary: boolean;
  position: number;
}

export interface ClassifiedImage {
  product_id: string;
  source_url: string;
  verified_url: string | null;
  verified_format: string | null;
  /** 'verified' = ready for feed, 'pending_derivative' = needs AVIF->JPG on CDN,
   *  'pending_verification' = needs HTTP check, 'invalid' = unusable */
  status:
    | 'verified'
    | 'pending_derivative'
    | 'pending_verification'
    | 'invalid';
  is_primary: boolean;
  position: number;
  failure_reason: string | null;
}

export type ProductImages =
  | Array<string | { url: string; alt?: string }>
  | null
  | undefined;

/**
 * Extract image candidates from a product's images field.
 * Normalizes both string arrays and object arrays into candidates.
 */
export function extractImageCandidates(
  productId: string,
  images: ProductImages
): BackfillImageCandidate[] {
  if (!images || !Array.isArray(images)) return [];

  const candidates: BackfillImageCandidate[] = [];
  let position = 0;

  for (const img of images) {
    const url = typeof img === 'string' ? img : img?.url;
    // Malformed JSONB rows (numeric or object URLs) must be skipped, not
    // throw: one bad offer image must not abort the merchant backfill.
    if (typeof url !== 'string' || !url.trim()) continue;

    candidates.push({
      product_id: productId,
      source_url: url.trim(),
      is_primary: position === 0,
      position,
    });
    position++;
  }

  return candidates;
}

const FORMAT_MAP: Record<string, string> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
  '.avif': 'avif',
};

/**
 * Detect image format from a URL by file extension.
 * Strips query strings and fragments before checking.
 */
export function getImageFormat(url: string): string | null {
  const pathname = url.split('?')[0].split('#')[0].toLowerCase();
  for (const [ext, format] of Object.entries(FORMAT_MAP)) {
    if (pathname.endsWith(ext)) return format;
  }
  return null;
}

/**
 * Replace `.avif` extension with `.jpg`, stripping any query string or fragment.
 * The derivative JPG is a different file — cache-busting params from the
 * original AVIF source do not apply.
 */
export function replaceAvifWithJpg(url: string): string {
  const qIndex = url.indexOf('?');
  const hIndex = url.indexOf('#');
  let endOfPath = url.length;
  if (qIndex !== -1) endOfPath = Math.min(endOfPath, qIndex);
  if (hIndex !== -1) endOfPath = Math.min(endOfPath, hIndex);
  const path = url.substring(0, endOfPath);
  return path.replace(/\.avif$/i, '.jpg');
}

/**
 * Classify a single image candidate for the feed manifest.
 *
 * - Absolute JPG/PNG/WebP -> pending_verification (needs reachability check)
 * - Absolute AVIF -> pending_derivative (needs `.jpg` sibling on CDN)
 * - Relative path -> absolutize + pending_verification (needs HTTP check)
 * - Empty/malformed -> invalid
 */
export function classifyFeedImageCandidate(
  candidate: BackfillImageCandidate,
  storefrontBaseUrl: string
): ClassifiedImage {
  const base: Omit<
    ClassifiedImage,
    'verified_url' | 'verified_format' | 'status' | 'failure_reason'
  > = {
    product_id: candidate.product_id,
    source_url: candidate.source_url,
    is_primary: candidate.is_primary,
    position: candidate.position,
  };

  if (!candidate.source_url || !candidate.source_url.trim()) {
    return {
      ...base,
      verified_url: null,
      verified_format: null,
      status: 'invalid',
      failure_reason: 'Empty source URL',
    };
  }

  // Handle relative paths
  if (candidate.source_url.startsWith('/')) {
    if (!storefrontBaseUrl || !storefrontBaseUrl.trim()) {
      return {
        ...base,
        verified_url: null,
        verified_format: null,
        status: 'invalid',
        failure_reason:
          'Cannot resolve relative path: storefrontBaseUrl is empty',
      };
    }
    let baseWithoutTrailingSlash = storefrontBaseUrl;
    while (baseWithoutTrailingSlash.endsWith('/')) {
      baseWithoutTrailingSlash = baseWithoutTrailingSlash.slice(0, -1);
    }
    const absoluteUrl = `${baseWithoutTrailingSlash}${candidate.source_url}`;
    const format = getImageFormat(absoluteUrl);
    if (!format) {
      return {
        ...base,
        verified_url: null,
        verified_format: null,
        status: 'invalid',
        failure_reason: `Unsupported format in relative path: ${candidate.source_url}`,
      };
    }
    if (format === 'avif') {
      return {
        ...base,
        verified_url: replaceAvifWithJpg(absoluteUrl),
        verified_format: 'jpeg',
        status: 'pending_derivative',
        failure_reason: null,
      };
    }
    return {
      ...base,
      verified_url: absoluteUrl,
      verified_format: format,
      status: 'pending_verification',
      failure_reason: null,
    };
  }

  // Validate as absolute URL
  try {
    const parsed = new URL(candidate.source_url);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        ...base,
        verified_url: null,
        verified_format: null,
        status: 'invalid',
        failure_reason: `Unsupported protocol: ${parsed.protocol}`,
      };
    }
  } catch {
    return {
      ...base,
      verified_url: null,
      verified_format: null,
      status: 'invalid',
      failure_reason: `Malformed URL: ${candidate.source_url}`,
    };
  }

  const format = getImageFormat(candidate.source_url);

  // AVIF -> needs derivative
  if (format === 'avif') {
    return {
      ...base,
      verified_url: replaceAvifWithJpg(candidate.source_url),
      verified_format: 'jpeg',
      status: 'pending_derivative',
      failure_reason: null,
    };
  }

  // JPG/PNG/WebP -> needs verification (reachability/content-type check)
  if (format) {
    return {
      ...base,
      verified_url: null,
      verified_format: null,
      status: 'pending_verification',
      failure_reason: null,
    };
  }

  // Unknown format
  return {
    ...base,
    verified_url: null,
    verified_format: null,
    status: 'invalid',
    failure_reason: `Unsupported image format: ${candidate.source_url}`,
  };
}

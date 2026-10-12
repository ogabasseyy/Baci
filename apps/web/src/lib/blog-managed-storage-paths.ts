import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { getPublicBlogMediaCdnOrigin } from '@/lib/blog-public-config';
import { getTrustedBlogImageOrigins } from '@/lib/get-trusted-blog-image-origins';

export const BLOG_FEATURED_VARIANT_KEYS = [
  'landscape_16x9',
  'standard_4x3',
  'square_1x1',
] as const;

export type BlogFeaturedVariantKey =
  (typeof BLOG_FEATURED_VARIANT_KEYS)[number];

export const PLATFORM_BLOG_MEDIA_PREFIX = 'platform/blog';

export type BlogStorageScope =
  | { kind: 'merchant'; merchantId: string }
  | { kind: 'platform' };

const BLOG_FEATURED_VARIANT_FILENAME = new RegExp(
  `^(${BLOG_FEATURED_VARIANT_KEYS.map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\.webp$`
);

function resolveBlogStorageScope(
  scopeOrMerchantId: string | BlogStorageScope
): BlogStorageScope | null {
  if (typeof scopeOrMerchantId === 'string') {
    const merchantId = scopeOrMerchantId.trim();
    return merchantId ? { kind: 'merchant', merchantId } : null;
  }

  if (scopeOrMerchantId.kind === 'platform') {
    return scopeOrMerchantId;
  }

  const merchantId = scopeOrMerchantId.merchantId.trim();
  return merchantId ? { kind: 'merchant', merchantId } : null;
}

function getExpectedPrefix(scope: BlogStorageScope): [string, string] {
  if (scope.kind === 'platform') {
    return ['platform', 'blog'];
  }

  return [scope.merchantId, 'blog'];
}

function getConfiguredBlogMediaCdnOrigin(origin?: string): string {
  const configured =
    origin || getPublicBlogMediaCdnOrigin() || DEFAULT_BLOG_MEDIA_CDN_ORIGIN;

  try {
    return new URL(configured).origin;
  } catch {
    return DEFAULT_BLOG_MEDIA_CDN_ORIGIN;
  }
}

function getTrustedBlogMediaOrigins(): string[] {
  // One trust set with the rest of the media pipeline: the deploy
  // override, the default CDN, and Supabase Storage.
  return getTrustedBlogImageOrigins();
}

export function isManagedBlogStoragePath(
  path: string,
  scopeOrMerchantId: string | BlogStorageScope
): boolean {
  const scope = resolveBlogStorageScope(scopeOrMerchantId);
  if (!scope) {
    return false;
  }

  if (
    !path ||
    path.includes('..') ||
    path.includes('//') ||
    path.startsWith('/')
  ) {
    return false;
  }

  const segments = path.split('/');
  if (segments.length < 3 || segments.length > 4) {
    return false;
  }

  const [expectedSegment0, expectedSegment1] = getExpectedPrefix(scope);
  if (segments[0] !== expectedSegment0 || segments[1] !== expectedSegment1) {
    return false;
  }

  const safeSegment = /^[a-zA-Z0-9._-]+$/;
  if (!safeSegment.test(segments[2])) {
    return false;
  }

  if (segments.length === 3) {
    return segments[2].includes('.');
  }

  return (
    !segments[2].includes('.') &&
    BLOG_FEATURED_VARIANT_FILENAME.test(segments[3])
  );
}

export function extractManagedBlogStoragePath(
  publicUrl: string,
  scopeOrMerchantId: string | BlogStorageScope,
  options?: { trustedOrigins?: readonly string[] }
): string | null {
  try {
    const parsed = new URL(publicUrl);
    // Pathname matching alone would treat an external lookalike (an
    // attacker- or user-controlled host serving /media/platform/blog/*)
    // as a managed object, so only the configured CDN and Supabase
    // origins extract. Callers without env access pass explicit origins.
    const trusted = options?.trustedOrigins ?? getTrustedBlogMediaOrigins();
    if (!trusted.includes(parsed.origin)) {
      return null;
    }
    const path = decodeURIComponent(parsed.pathname);
    const bucketPathMarker = '/storage/v1/object/public/media/';
    const directMediaMarker = '/media/';

    const managedPath = path.includes(bucketPathMarker)
      ? path.slice(path.indexOf(bucketPathMarker) + bucketPathMarker.length)
      : path.includes(directMediaMarker)
        ? path.slice(path.indexOf(directMediaMarker) + directMediaMarker.length)
        : '';

    const normalized = managedPath.replace(/^\/+/, '');
    if (!isManagedBlogStoragePath(normalized, scopeOrMerchantId)) {
      return null;
    }

    return normalized;
  } catch {
    return null;
  }
}

export function buildBlogMediaCdnUrl(
  storagePath: string,
  scopeOrMerchantId: string | BlogStorageScope,
  origin?: string
): string | null {
  const normalized = storagePath.trim().replace(/^\/+/, '');
  if (!isManagedBlogStoragePath(normalized, scopeOrMerchantId)) {
    return null;
  }

  const encodedPath = normalized.split('/').map(encodeURIComponent).join('/');
  return `${getConfiguredBlogMediaCdnOrigin(origin)}/media/${encodedPath}`;
}

export function canonicalizeBlogMediaUrl(
  publicUrlOrPath: string,
  scopeOrMerchantId: string | BlogStorageScope,
  origin?: string
): string | null {
  const input = publicUrlOrPath.trim();
  const storagePath = isManagedBlogStoragePath(input, scopeOrMerchantId)
    ? input
    : extractManagedBlogStoragePath(input, scopeOrMerchantId);

  return storagePath
    ? buildBlogMediaCdnUrl(storagePath, scopeOrMerchantId, origin)
    : null;
}

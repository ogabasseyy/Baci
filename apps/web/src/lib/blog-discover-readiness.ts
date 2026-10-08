import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import {
  BLOG_FEATURED_VARIANT_KEYS,
  type BlogFeaturedVariantKey,
  type BlogStorageScope,
  extractManagedBlogStoragePath,
} from '@/lib/blog-managed-storage-paths';

const MIN_DISCOVER_IMAGE_WIDTH = 1200;
const MIN_DISCOVER_IMAGE_HEIGHT = 675;
const MIN_EXCLUSIVE_DISCOVER_IMAGE_PIXELS = 300_000;
const GENERATED_CODEX_BLOG_IMAGE_PREFIX = '/core-assets/blog/codex/';
const TRANSFORMED_CDN_IMAGE_PREFIX = '/image/';
const GENERATED_CODEX_BLOG_IMAGE_EXTENSION_PATTERN =
  /\.(avif|jpe?g|png|webp)$/i;
const GENERATED_CODEX_BLOG_IMAGE_EXTENSIONS = [
  '.avif',
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
] as const;
const BLOG_FEATURED_VARIANT_KEY_SET = new Set<string>(
  BLOG_FEATURED_VARIANT_KEYS
);

export type BlogDiscoverImageReadinessCode =
  | 'BLOG_FEATURED_IMAGE_NOT_DISCOVER_READY'
  | 'BLOG_FEATURED_IMAGE_NOT_MANAGED'
  | 'BLOG_FEATURED_IMAGE_VARIANT_MISSING'
  | 'BLOG_FEATURED_IMAGE_VARIANT_NOT_MANAGED'
  | 'BLOG_FEATURED_IMAGE_VARIANTS_INVALID';

export type BlogDiscoverImageReadinessResult =
  | { ready: true }
  | {
      ready: false;
      code: BlogDiscoverImageReadinessCode;
      details: Record<string, unknown>;
    };

export type BlogDiscoverImageReadinessState =
  | 'ready'
  | 'legacy_missing_metadata'
  | 'missing_featured_image'
  | 'unmanaged_featured_image'
  | 'missing_landscape_variant';

type BlogDiscoverImageFields = {
  status?: string | null;
  featured_image_url?: string | null;
  featured_image_width?: number | null;
  featured_image_height?: number | null;
  featured_image_variants?: Record<string, unknown> | null;
};

const trustedOriginCandidates = [
  process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN ||
    DEFAULT_BLOG_MEDIA_CDN_ORIGIN,
  process.env.NEXT_PUBLIC_SUPABASE_URL,
];

const TRUSTED_BLOG_IMAGE_ORIGINS = new Set(
  trustedOriginCandidates.flatMap((value) => {
    if (!value) {
      return [];
    }

    try {
      return [new URL(value).origin];
    } catch {
      return [];
    }
  })
);

function notReady(
  code: BlogDiscoverImageReadinessCode,
  details: Record<string, unknown>
): BlogDiscoverImageReadinessResult {
  return { ready: false, code, details };
}

function getReason(details: Record<string, unknown>): string | null {
  return typeof details.reason === 'string' ? details.reason : null;
}

function getVariantMap(
  value: BlogDiscoverImageFields['featured_image_variants']
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value;
}

export function isBlogFeaturedVariantKey(
  value: string
): value is BlogFeaturedVariantKey {
  return BLOG_FEATURED_VARIANT_KEY_SET.has(value);
}

function isManagedOriginalBlogPath(path: string | null): path is string {
  return Boolean(path && path.split('/').length === 3);
}

function isManagedVariantBlogPath(path: string | null): path is string {
  return Boolean(path && path.split('/').length === 4);
}

function isTrustedManagedBlogImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === 'https:' && TRUSTED_BLOG_IMAGE_ORIGINS.has(url.origin)
    );
  } catch {
    return false;
  }
}

export function getTrustedCdnSourcePath(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      !TRUSTED_BLOG_IMAGE_ORIGINS.has(url.origin)
    ) {
      return null;
    }

    const path = decodeURIComponent(url.pathname);
    if (!path.startsWith(TRANSFORMED_CDN_IMAGE_PREFIX)) {
      return path;
    }

    const transformPath = path.slice(TRANSFORMED_CDN_IMAGE_PREFIX.length);
    const sourcePathIndex = transformPath.indexOf('/');
    if (sourcePathIndex <= 0) {
      return null;
    }

    return `/${transformPath.slice(sourcePathIndex + 1)}`;
  } catch {
    return null;
  }
}

export function isTrustedGeneratedCodexBlogImageUrl(raw: string): boolean {
  const sourcePath = getTrustedCdnSourcePath(raw);
  return Boolean(
    sourcePath?.startsWith(GENERATED_CODEX_BLOG_IMAGE_PREFIX) &&
      !sourcePath.includes('..') &&
      GENERATED_CODEX_BLOG_IMAGE_EXTENSION_PATTERN.test(sourcePath)
  );
}

export function isTrustedGeneratedCodexBlogVariantUrl(
  raw: string,
  variantKey: BlogFeaturedVariantKey
): boolean {
  const sourcePath = getTrustedCdnSourcePath(raw);
  if (
    !sourcePath?.startsWith(GENERATED_CODEX_BLOG_IMAGE_PREFIX) ||
    sourcePath.includes('..') ||
    !GENERATED_CODEX_BLOG_IMAGE_EXTENSION_PATTERN.test(sourcePath)
  ) {
    return false;
  }

  const filename = sourcePath.split('/').at(-1)?.toLowerCase() ?? '';
  const variantFilename = variantKey.toLowerCase();
  return GENERATED_CODEX_BLOG_IMAGE_EXTENSIONS.some(
    (extension) =>
      filename === `${variantFilename}${extension}` ||
      filename.endsWith(`-${variantFilename}${extension}`)
  );
}

export function validateBlogImageVariantIntegrity(
  image: Pick<BlogDiscoverImageFields, 'featured_image_variants'>,
  storageScope: string | BlogStorageScope
): BlogDiscoverImageReadinessResult {
  const variants = getVariantMap(image.featured_image_variants);

  for (const [key, value] of Object.entries(variants)) {
    if (!isBlogFeaturedVariantKey(key)) {
      return notReady('BLOG_FEATURED_IMAGE_VARIANTS_INVALID', {
        variantKey: key,
      });
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
      continue;
    }

    if (!isTrustedManagedBlogImageUrl(value)) {
      return notReady('BLOG_FEATURED_IMAGE_VARIANT_NOT_MANAGED', {
        variantKey: key,
      });
    }

    const path = extractManagedBlogStoragePath(value, storageScope);
    if (
      !isManagedVariantBlogPath(path) &&
      !isTrustedGeneratedCodexBlogVariantUrl(value, key)
    ) {
      return notReady('BLOG_FEATURED_IMAGE_VARIANT_NOT_MANAGED', {
        variantKey: key,
      });
    }
  }

  return { ready: true };
}

export function validateBlogDiscoverImageReadiness(
  image: BlogDiscoverImageFields,
  storageScope: string | BlogStorageScope
): BlogDiscoverImageReadinessResult {
  const variantIntegrity = validateBlogImageVariantIntegrity(
    image,
    storageScope
  );
  if (!variantIntegrity.ready) {
    return variantIntegrity;
  }

  if (!image.featured_image_url) {
    return notReady('BLOG_FEATURED_IMAGE_NOT_DISCOVER_READY', {
      reason: 'missing_featured_image',
    });
  }

  const isTrustedGeneratedCodexBlogImage = isTrustedGeneratedCodexBlogImageUrl(
    image.featured_image_url
  );

  if (
    !isTrustedManagedBlogImageUrl(image.featured_image_url) &&
    !isTrustedGeneratedCodexBlogImage
  ) {
    return notReady('BLOG_FEATURED_IMAGE_NOT_MANAGED', {
      reason: 'unmanaged_featured_image',
    });
  }

  const originalPath = isTrustedGeneratedCodexBlogImage
    ? null
    : extractManagedBlogStoragePath(image.featured_image_url, storageScope);
  if (
    !isTrustedGeneratedCodexBlogImage &&
    !isManagedOriginalBlogPath(originalPath)
  ) {
    return notReady('BLOG_FEATURED_IMAGE_NOT_MANAGED', {
      reason: 'unmanaged_featured_image',
    });
  }

  const width = image.featured_image_width;
  const height = image.featured_image_height;
  if (
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    width < MIN_DISCOVER_IMAGE_WIDTH ||
    height < MIN_DISCOVER_IMAGE_HEIGHT ||
    width * height <= MIN_EXCLUSIVE_DISCOVER_IMAGE_PIXELS
  ) {
    return notReady('BLOG_FEATURED_IMAGE_NOT_DISCOVER_READY', {
      reason: 'dimensions_too_small',
      width,
      height,
    });
  }

  const landscapeUrl = getVariantMap(
    image.featured_image_variants
  ).landscape_16x9;
  if (typeof landscapeUrl !== 'string' || landscapeUrl.trim().length === 0) {
    return notReady('BLOG_FEATURED_IMAGE_VARIANT_MISSING', {
      variantKey: 'landscape_16x9',
    });
  }

  const landscapePath = extractManagedBlogStoragePath(
    landscapeUrl,
    storageScope
  );
  if (
    !isManagedVariantBlogPath(landscapePath) &&
    !isTrustedGeneratedCodexBlogVariantUrl(landscapeUrl, 'landscape_16x9')
  ) {
    return notReady('BLOG_FEATURED_IMAGE_VARIANT_NOT_MANAGED', {
      variantKey: 'landscape_16x9',
    });
  }

  return { ready: true };
}

export function classifyBlogDiscoverImageReadiness(
  post: BlogDiscoverImageFields,
  storageScope: string | BlogStorageScope
): BlogDiscoverImageReadinessState {
  if (post.status !== 'published') {
    return 'ready';
  }

  const result = validateBlogDiscoverImageReadiness(post, storageScope);
  if (result.ready) {
    return 'ready';
  }

  if (getReason(result.details) === 'missing_featured_image') {
    return 'missing_featured_image';
  }

  if (result.code === 'BLOG_FEATURED_IMAGE_NOT_MANAGED') {
    return 'unmanaged_featured_image';
  }

  if (result.code === 'BLOG_FEATURED_IMAGE_VARIANT_MISSING') {
    return 'missing_landscape_variant';
  }

  return 'legacy_missing_metadata';
}

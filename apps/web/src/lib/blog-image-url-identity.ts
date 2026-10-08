import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import {
  BLOG_FEATURED_VARIANT_KEYS,
  type BlogFeaturedVariantKey,
} from '@/lib/blog-managed-storage-paths';

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

export function isBlogFeaturedVariantKey(
  value: string
): value is BlogFeaturedVariantKey {
  return BLOG_FEATURED_VARIANT_KEY_SET.has(value);
}

export function isTrustedManagedBlogImageUrl(raw: string): boolean {
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

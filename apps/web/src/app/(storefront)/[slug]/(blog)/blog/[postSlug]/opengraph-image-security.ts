import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';
import { env } from '@/env';
import {
  type BlogStorageScope,
  extractManagedBlogStoragePath,
} from '@/lib/blog-managed-storage-paths';
import { PLATFORM_BLOG_CONTEXT } from '@/lib/platform-blog';

export { getBlogCacheTag } from '@/lib/blog-cache-tags';

const trustedOriginCandidates = [
  env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN || DEFAULT_BLOG_MEDIA_CDN_ORIGIN,
  env.NEXT_PUBLIC_SUPABASE_URL,
];

const TRUSTED_OG_IMAGE_ORIGINS = new Set(
  trustedOriginCandidates.flatMap((value) => {
    if (!value) return [];
    try {
      return [new URL(value).origin];
    } catch {
      return [];
    }
  })
);

const TRUSTED_LOGO_ORIGINS = new Set([
  ...TRUSTED_OG_IMAGE_ORIGINS,
  ...(() => {
    try {
      return [new URL(PLATFORM_BLOG_CONTEXT.baseUrl).origin];
    } catch {
      return [];
    }
  })(),
]);

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out`)),
      timeoutMs
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function isAllowedBlogOgImageUrl(
  raw: string,
  storageScope: string | BlogStorageScope
): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return false;
    if (!TRUSTED_OG_IMAGE_ORIGINS.has(url.origin)) return false;
    // The extractor re-validates the origin against process.env, which
    // diverges from this module's validated env source, so pass the
    // already-checked origins explicitly for a single trust decision.
    return (
      extractManagedBlogStoragePath(raw, storageScope, {
        trustedOrigins: [...TRUSTED_OG_IMAGE_ORIGINS],
      }) !== null
    );
  } catch {
    return false;
  }
}

export function isAllowedLogoUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && TRUSTED_LOGO_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';

/**
 * Trusted origins for blog media URLs, read per call so tests can
 * stub them. The deploy CDN origin is trusted along with the
 * default, so existing managed URLs keep working when the
 * environment overrides the CDN host. Direct Supabase Storage URLs
 * stay trusted too. This is the single composition behind both the
 * frozen `TRUSTED_BLOG_IMAGE_ORIGINS` set and the extractor gate.
 */
export function getTrustedBlogImageOrigins(): string[] {
  const origins = new Set<string>();
  for (const candidate of [
    process.env.NEXT_PUBLIC_BLOG_MEDIA_CDN_ORIGIN,
    DEFAULT_BLOG_MEDIA_CDN_ORIGIN,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ]) {
    if (!candidate) continue;
    try {
      origins.add(new URL(candidate).origin);
    } catch {
      // A malformed origin simply contributes nothing.
    }
  }
  return [...origins];
}

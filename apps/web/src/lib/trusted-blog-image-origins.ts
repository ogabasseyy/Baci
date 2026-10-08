import { DEFAULT_BLOG_MEDIA_CDN_ORIGIN } from '@/config/cdn';

// Trusted origins for blog media URLs. The deploy CDN origin is
// trusted along with the default, so generated fixtures keep
// working when the environment overrides the CDN host. Direct
// Supabase Storage URLs stay trusted too: managed-path extraction
// explicitly supports them, and Discover readiness classifies
// uploads by the same trust set.
export const TRUSTED_BLOG_IMAGE_ORIGINS: ReadonlySet<string> = (() => {
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
      // Ignore malformed origins: the default below still applies.
    }
  }
  return origins;
})();

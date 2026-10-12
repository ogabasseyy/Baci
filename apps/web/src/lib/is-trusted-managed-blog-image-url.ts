import { TRUSTED_BLOG_IMAGE_ORIGINS } from './trusted-blog-image-origins';

// Whether a URL is an HTTPS blog image on a trusted origin. Relative
// URLs fail closed: only absolute URLs parse to an origin.
export function isTrustedManagedBlogImageUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return (
      parsed.protocol === 'https:' &&
      TRUSTED_BLOG_IMAGE_ORIGINS.has(parsed.origin)
    );
  } catch {
    return false;
  }
}

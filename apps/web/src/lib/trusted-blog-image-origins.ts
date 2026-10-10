import { getTrustedBlogImageOrigins } from './get-trusted-blog-image-origins';

// Frozen at import for callers that need a stable set; see
// getTrustedBlogImageOrigins for the composition.
export const TRUSTED_BLOG_IMAGE_ORIGINS: ReadonlySet<string> = new Set(
  getTrustedBlogImageOrigins()
);

import { BLOG_FEATURED_VARIANT_KEYS } from '@/lib/blog-managed-storage-paths';

// Known featured-image variant keys. Unknown keys stay out of
// variant binding: only keys the pipeline emits may claim a
// variant URL.
export function isBlogFeaturedVariantKey(value: string): boolean {
  return (BLOG_FEATURED_VARIANT_KEYS as readonly string[]).includes(value);
}

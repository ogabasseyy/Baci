import type { ComponentProps } from 'react';
import { SafeHtml } from '@/components/ui/safe-html';
import { removeDuplicateLegacyFeaturedImage } from '@/lib/blog-legacy-featured-image-dedupe';

interface BlogLegacyContentProps {
  html: string;
  featuredImageUrl?: string | null;
  trustedPriorityImageSources?: ComponentProps<
    typeof SafeHtml
  >['trustedPriorityImageSources'];
}

/** Renders sanitized legacy content using the resolved storefront theme. */
export function BlogLegacyContent({
  html,
  featuredImageUrl,
  trustedPriorityImageSources,
}: BlogLegacyContentProps) {
  return (
    <SafeHtml
      data-testid="blog-post-legacy-content"
      html={removeDuplicateLegacyFeaturedImage(html, featuredImageUrl)}
      trustedPriorityImageSources={trustedPriorityImageSources}
      normalizeHeadingHierarchy={true}
      normalizeSeoAnchors={true}
      className="prose dark:prose-invert prose-baci max-w-none w-full"
    />
  );
}

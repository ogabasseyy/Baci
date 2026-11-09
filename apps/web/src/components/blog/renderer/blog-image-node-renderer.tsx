import { isStablePublicMediaUrl } from '@baci/shared/storefront';
import Image from 'next/image';
import {
  buildInlineImageSiblings,
  isLegacyOgabasseyCdnBlogImage,
  isTrustedCdnInlineImage,
} from '@/lib/blog-inline-image-optimization';
import { logger } from '@/lib/logger';
import { sanitizeUrl } from '@/lib/sanitize-core';
import { cn } from '@/lib/utils';
import type { PriorityInlineImage, TipTapNode } from './blog-tiptap-node';

export interface BlogImageNodeRendererProps {
  node: TipTapNode;
  nodePath: string;
  priorityInlineImage?: PriorityInlineImage | null;
}

/**
 * Renders a TipTap image node. Trusted CDN inline images serve their
 * pre-optimized AVIF/WebP siblings via <picture> (next/image would
 * needlessly re-process an already-optimized CDN URL); everything else goes
 * through next/image. Legacy ogabassey CDN blog images are dropped.
 */
export const BlogImageNodeRenderer = ({
  node,
  nodePath,
  priorityInlineImage,
}: BlogImageNodeRendererProps) => {
  // Guard against missing src to prevent runtime errors
  const rawSrc = node.attrs?.src;
  const imageSrc =
    typeof rawSrc === 'string'
      ? isStablePublicMediaUrl(rawSrc)
        ? rawSrc
        : sanitizeUrl(rawSrc)
      : '';
  const imageCaption =
    (typeof node.attrs?.title === 'string' ? node.attrs.title : '').trim() ||
    (typeof node.attrs?.caption === 'string' ? node.attrs.caption.trim() : '');

  // Only allow http/https or content-addressed release media for security and CDN stability.
  if (
    !imageSrc ||
    (!imageSrc.startsWith('http') && !isStablePublicMediaUrl(imageSrc))
  ) {
    logger.warn({
      message: 'Blog image node missing or invalid src attribute',
      src: rawSrc ?? null,
    });
    return null;
  }

  if (isLegacyOgabasseyCdnBlogImage(imageSrc)) {
    return null;
  }

  const imageAlt = node.attrs?.alt || 'Blog image';
  const inlineSiblings = isTrustedCdnInlineImage(imageSrc)
    ? buildInlineImageSiblings(imageSrc)
    : null;
  const isPriorityInlineImage =
    !!inlineSiblings &&
    imageSrc === priorityInlineImage?.src &&
    nodePath === priorityInlineImage.nodePath;
  const imageContainer = (
    <div
      className={cn(
        'relative aspect-video rounded-2xl overflow-hidden shadow-xl border border-border/50',
        !imageCaption && 'my-10'
      )}
    >
      {inlineSiblings ? (
        <picture>
          <source
            srcSet={inlineSiblings.avifSrcSet}
            sizes={inlineSiblings.sizes}
            type="image/avif"
          />
          <source
            srcSet={inlineSiblings.webpSrcSet}
            sizes={inlineSiblings.sizes}
            type="image/webp"
          />
          <img
            src={inlineSiblings.fallback}
            srcSet={inlineSiblings.fallbackSrcSet}
            sizes={inlineSiblings.sizes}
            width={inlineSiblings.width}
            height={inlineSiblings.height}
            alt={imageAlt}
            className="absolute inset-0 h-full w-full object-cover"
            decoding="async"
            fetchPriority={isPriorityInlineImage ? 'high' : undefined}
            loading={isPriorityInlineImage ? 'eager' : 'lazy'}
          />
        </picture>
      ) : (
        <Image
          src={imageSrc}
          alt={imageAlt}
          fill
          className="object-cover"
          sizes="(max-width: 768px) 100vw, 800px"
        />
      )}
    </div>
  );

  if (!imageCaption) {
    return imageContainer;
  }

  return (
    <figure className="my-10">
      {imageContainer}
      <figcaption className="mt-3 text-center text-sm leading-relaxed text-muted-foreground">
        {imageCaption}
      </figcaption>
    </figure>
  );
};

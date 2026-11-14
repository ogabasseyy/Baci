import { isStablePublicMediaUrl } from '@baci/shared/storefront';
import {
  isLegacyOgabasseyCdnBlogImage,
  isTrustedCdnInlineImage,
} from '@/lib/blog-inline-image-optimization';
import { sanitizeUrl } from '@/lib/sanitize-core';
import type { PriorityInlineImage, TipTapNode } from './blog-tiptap-node';

function findFirstRenderableImageNode(
  node: TipTapNode,
  nodePath: string
): { src: string; nodePath: string } | null {
  if (node.type === 'image') {
    const rawSrc = node.attrs?.src;
    const src =
      typeof rawSrc === 'string'
        ? isStablePublicMediaUrl(rawSrc)
          ? rawSrc
          : sanitizeUrl(rawSrc)
        : '';
    return (src?.startsWith('http') || isStablePublicMediaUrl(src)) &&
      !isLegacyOgabasseyCdnBlogImage(src)
      ? { src, nodePath }
      : null;
  }

  for (const [index, child] of (node.content ?? []).entries()) {
    const found = findFirstRenderableImageNode(child, `${nodePath}.${index}`);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * The first rendered image is the only body LCP candidate, so stop at it and
 * only prioritize when it is a trusted, optimized inline image. Never skip an
 * earlier (untrusted) image to prioritize a later one — that would set
 * fetchPriority="high" on an image that cannot be the LCP.
 */
export function findFirstTrustedInlineImage(
  node: TipTapNode,
  nodePath: string,
  targetSrc?: string
): PriorityInlineImage | null {
  const first = findFirstRenderableImageNode(node, nodePath);
  if (!first) {
    return null;
  }
  if (targetSrc !== undefined && first.src !== targetSrc) {
    return null;
  }
  if (first.src.startsWith('http') && isTrustedCdnInlineImage(first.src)) {
    return { src: first.src, nodePath: first.nodePath };
  }
  return null;
}

import type React from 'react';
import { SafeHtml } from '@/components/ui/safe-html';
import { generateHeadingId } from '@/lib/blog-utils';
import { logger } from '@/lib/logger';
import type { StorefrontContentLinkRewrites } from '@/lib/storefront-content-link-rewriting';
import type { DeadStorefrontContentLinkSlugs } from '@/lib/storefront-content-link-targets';
import { cn } from '@/lib/utils';
import { BlogCodeBlockRenderer } from './blog-code-block-renderer';
import {
  getBlogBodyHeadingLevel,
  HEADING_SIZE_CLASSES,
  normalizeSourceHeadingLevel,
} from './blog-heading-levels';
import { BlogImageNodeRenderer } from './blog-image-node-renderer';
import { BlogDocWithOptionalAd, parseBlogDoc } from './blog-in-article-ad';
import { findFirstTrustedInlineImage } from './blog-priority-inline-image';
import { BlogTextRenderer } from './blog-text-renderer';
import {
  type DeadContentLinkSets,
  extractNodeText,
  type PriorityInlineImage,
  type TipTapNode,
} from './blog-tiptap-node';

// Explicit text alignment class mapping for Tailwind tree-shaking (2026 best practice)
const TEXT_ALIGN_CLASSES: Record<string, string> = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
  justify: 'text-justify',
};

// Premium 2026 JSON-to-React renderer: recursively renders TipTap JSON as
// native React components.
interface NodeRendererProps {
  basePath?: string;
  baseUrl?: string;
  contentLinkRewrites?: StorefrontContentLinkRewrites;
  deadContentLinkSets?: DeadContentLinkSets;
  merchantSlug?: string;
  node: TipTapNode;
  nodePath: string;
  index: number;
  priorityInlineImage?: PriorityInlineImage | null;
}

interface BlogContentRendererProps {
  basePath?: string;
  baseUrl?: string;
  /**
   * Canonical replacements for internal links that resolve through permanent
   * redirects (renamed posts, consolidated/re-categorized products). Matching
   * hrefs are rewritten in place. Applied before the dead-link check.
   */
  contentLinkRewrites?: StorefrontContentLinkRewrites;
  /**
   * Internal blog/product slugs known to be dead (unpublished posts, missing
   * products). Links resolving to them render as plain text instead of 404s.
   */
  deadContentLinks?: DeadStorefrontContentLinkSlugs;
  /**
   * Optional mid-article ad slot injected once after the 3rd top-level
   * paragraph on long-form posts (>= 5 top-level blocks) so it stays below the
   * LCP hero/intro window.
   */
  inArticleAdSlot?: React.ReactNode;
  // biome-ignore lint/suspicious/noExplicitAny: TipTap library returns any type
  json: any;
  merchantSlug?: string;
  priorityInlineImageSrc?: string | null;
}

const NodeRenderer = ({
  basePath,
  baseUrl,
  contentLinkRewrites,
  deadContentLinkSets,
  merchantSlug,
  node,
  nodePath,
  index: _index,
  priorityInlineImage,
}: NodeRendererProps): React.ReactNode => {
  const children = node.content?.map((child, i) => (
    <NodeRenderer
      // biome-ignore lint/suspicious/noArrayIndexKey: TipTap sibling nodes do not expose stable ids; document order defines render identity.
      key={`${child.type}-${i}`}
      basePath={basePath}
      baseUrl={baseUrl}
      contentLinkRewrites={contentLinkRewrites}
      deadContentLinkSets={deadContentLinkSets}
      merchantSlug={merchantSlug}
      node={child}
      nodePath={`${nodePath}.${i}`}
      index={i}
      priorityInlineImage={priorityInlineImage}
    />
  ));

  // Use explicit mapping for Tailwind tree-shaking (avoids dynamic class generation)
  const textAlignClass = node.attrs?.textAlign
    ? TEXT_ALIGN_CLASSES[node.attrs.textAlign] || ''
    : '';

  switch (node.type) {
    case 'doc':
      return <div className="space-y-4">{children}</div>;

    case 'paragraph':
      // Safety: Empty paragraphs should render a break or space
      if (!node.content || node.content.length === 0) return <br />;
      return (
        <p className={cn('leading-relaxed', textAlignClass)}>{children}</p>
      );

    case 'heading': {
      const sourceLevel = normalizeSourceHeadingLevel(node.attrs?.level);
      const renderedLevel = getBlogBodyHeadingLevel(sourceLevel);
      const Tag = `h${renderedLevel}` as keyof React.JSX.IntrinsicElements;
      const sizeClasses =
        HEADING_SIZE_CLASSES[sourceLevel] || 'text-lg font-bold';

      const headingText = extractNodeText(node);
      const headingId = generateHeadingId(headingText);

      return (
        <Tag
          id={headingId}
          className={cn(sizeClasses, textAlignClass, 'scroll-mt-20 group')}
        >
          {children}
          <a
            href={`#${headingId}`}
            className="ml-2 opacity-0 group-hover:opacity-50 transition-opacity text-muted-foreground"
            aria-label={`Link to ${headingText}`}
          >
            #
          </a>
        </Tag>
      );
    }

    case 'bulletList':
      return <ul className="list-disc pl-6 space-y-2 my-6">{children}</ul>;

    case 'orderedList':
      return <ol className="list-decimal pl-6 space-y-2 my-6">{children}</ol>;

    case 'listItem':
      return <li className="leading-relaxed">{children}</li>;

    case 'blockquote':
      return (
        <blockquote className="border-l-4 border-primary/40 bg-muted/30 px-6 py-4 italic rounded-r-lg my-8">
          {children}
        </blockquote>
      );

    case 'image':
      return (
        <BlogImageNodeRenderer
          node={node}
          nodePath={nodePath}
          priorityInlineImage={priorityInlineImage}
        />
      );

    case 'table':
      return (
        <div className="overflow-x-auto my-8 border border-border rounded-xl">
          <table className="w-full border-collapse text-sm">
            <tbody>{children}</tbody>
          </table>
        </div>
      );

    case 'tableRow':
      return (
        <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
          {children}
        </tr>
      );

    case 'tableHeader':
      return (
        <th className="bg-muted/50 px-4 py-3 text-left font-semibold text-foreground border-r border-border/50">
          {children}
        </th>
      );

    case 'tableCell':
      return (
        <td className="px-4 py-3 border-r border-border/50 text-muted-foreground">
          {children}
        </td>
      );

    case 'codeBlock':
      return (
        <BlogCodeBlockRenderer node={node}>{children}</BlogCodeBlockRenderer>
      );

    case 'horizontalRule':
      return <hr className="my-12 border-t border-border" />;

    case 'text':
      return (
        <BlogTextRenderer
          node={node}
          basePath={basePath}
          baseUrl={baseUrl}
          contentLinkRewrites={contentLinkRewrites}
          deadContentLinkSets={deadContentLinkSets}
          merchantSlug={merchantSlug}
        />
      );

    case 'hardBreak':
      return <br />;

    default:
      logger.warn({
        message: 'Unknown blog renderer node type',
        nodeType: node.type,
      });
      return null;
  }
};

export const BlogContentRenderer = ({
  json,
  basePath,
  baseUrl,
  contentLinkRewrites,
  deadContentLinks,
  inArticleAdSlot,
  merchantSlug,
  priorityInlineImageSrc,
}: BlogContentRendererProps) => {
  if (!json) return null;

  const parsed = parseBlogDoc(json);

  if (parsed.kind === 'fallback') {
    return <SafeHtml html={typeof json === 'string' ? json : ''} />;
  }

  const priorityInlineImage =
    priorityInlineImageSrc === null
      ? null
      : findFirstTrustedInlineImage(parsed.doc, '0', priorityInlineImageSrc);

  const hasDeadContentLinks =
    !!deadContentLinks &&
    (deadContentLinks.blog.length > 0 || deadContentLinks.products.length > 0);
  const deadContentLinkSets = hasDeadContentLinks
    ? {
        blog: new Set(deadContentLinks.blog),
        products: new Set(deadContentLinks.products),
      }
    : undefined;
  const hasContentLinkRewrites =
    !!contentLinkRewrites &&
    (Object.keys(contentLinkRewrites.blogSlugs).length > 0 ||
      Object.keys(contentLinkRewrites.productPaths).length > 0);

  return (
    <div className="blog-content-renderer prose dark:prose-invert prose-baci max-w-none text-foreground">
      <BlogDocWithOptionalAd
        doc={parsed.doc}
        inArticleAdSlot={inArticleAdSlot}
        renderNode={(node, nodePath, index) => (
          <NodeRenderer
            basePath={basePath}
            baseUrl={baseUrl}
            contentLinkRewrites={
              hasContentLinkRewrites ? contentLinkRewrites : undefined
            }
            deadContentLinkSets={deadContentLinkSets}
            merchantSlug={merchantSlug}
            node={node}
            nodePath={nodePath}
            index={index}
            priorityInlineImage={priorityInlineImage}
          />
        )}
      />
    </div>
  );
};

import type { ReactNode } from 'react';
import { logger } from '@/lib/logger';
import type { TipTapNode } from './blog-tiptap-node';

export type ParsedBlogDoc =
  | { kind: 'doc'; doc: TipTapNode }
  | { kind: 'fallback' };

// Parse + validate the TipTap JSON outside of render so JSX is never
// constructed inside a try/catch (react.dev: construct JSX in an error
// boundary, not a try/catch, since render errors escape the try block).
export function parseBlogDoc(json: unknown): ParsedBlogDoc {
  try {
    const doc = typeof json === 'string' ? JSON.parse(json) : json;
    if (
      doc &&
      typeof doc === 'object' &&
      (doc as { type?: unknown }).type === 'doc'
    ) {
      return { kind: 'doc', doc: doc as TipTapNode };
    }
  } catch (e) {
    logger.error({
      error: e,
      message: 'Blog renderer failed to parse document',
    });
  }
  return { kind: 'fallback' };
}

/**
 * Finds the top-level block index after which a single mid-article ad should be
 * injected (after the 3rd non-empty paragraph on posts with >= 5 blocks, never
 * as the trailing element). Returns -1 when no mid-article slot should render.
 */
export function findInArticleAdInsertIndex(
  topLevelNodes: TipTapNode[] | undefined,
  hasAdSlot: boolean
): number {
  if (!hasAdSlot || !topLevelNodes || topLevelNodes.length < 5) {
    return -1;
  }

  let nonEmptyParagraphCount = 0;
  for (let i = 0; i < topLevelNodes.length; i += 1) {
    const candidate = topLevelNodes[i];
    if (
      candidate?.type === 'paragraph' &&
      candidate.content &&
      candidate.content.length > 0
    ) {
      nonEmptyParagraphCount += 1;
      if (nonEmptyParagraphCount === 3 && i < topLevelNodes.length - 1) {
        return i;
      }
    }
  }

  return -1;
}

interface BlogDocWithOptionalAdProps {
  doc: TipTapNode;
  inArticleAdSlot?: ReactNode;
  renderNode: (node: TipTapNode, nodePath: string, index: number) => ReactNode;
}

export function BlogDocWithOptionalAd({
  doc,
  inArticleAdSlot,
  renderNode,
}: BlogDocWithOptionalAdProps) {
  const topLevelNodes = doc.content ?? [];
  const insertAfterIndex = findInArticleAdInsertIndex(
    topLevelNodes,
    Boolean(inArticleAdSlot)
  );

  if (insertAfterIndex < 0) {
    return <>{renderNode(doc, '0', 0)}</>;
  }

  return (
    <div className="space-y-4">
      {topLevelNodes.map((child, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: TipTap sibling nodes do not expose stable ids; document order defines render identity.
        <div key={`${child.type}-${i}`} className="contents">
          {renderNode(child, `0.${i}`, i)}
          {i === insertAfterIndex ? (
            <div className="not-prose my-8 flex justify-center">
              {inArticleAdSlot}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

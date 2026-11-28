import type { ReactNode } from 'react';
import type { TipTapNode } from './blog-tiptap-node';
import { findInArticleAdInsertIndex } from './find-in-article-ad-insert-index';

interface BlogDocWithOptionalAdProps {
  doc: TipTapNode;
  inArticleAdSlot?: ReactNode;
  renderNode: (node: TipTapNode, nodePath: string, index: number) => ReactNode;
}

/**
 * Renders a TipTap `doc` tree, optionally injecting `inArticleAdSlot` once
 * after the 3rd non-empty paragraph on long articles. On mobile, `-mx-6`
 * reclaims the article card's horizontal padding and `min-[340px]:flex` keeps
 * `300px` creatives hidden on `<340px` screens so they are never clipped.
 */
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
            <div className="not-prose -mx-6 my-8 hidden justify-center min-[340px]:flex sm:mx-0">
              {inArticleAdSlot}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

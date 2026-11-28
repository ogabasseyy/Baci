import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BlogDocWithOptionalAd } from './blog-in-article-ad';
import type { TipTapNode } from './blog-tiptap-node';

const makePara = (text: string): TipTapNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

describe('BlogDocWithOptionalAd', () => {
  it('delegates directly to renderNode(doc, "0", 0) when no insertion index matches', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [makePara('One'), makePara('Two')],
    };
    const renderNode = vi.fn((node: TipTapNode) => (
      <div data-testid="doc-root">{node.type}</div>
    ));

    render(
      <BlogDocWithOptionalAd
        doc={doc}
        inArticleAdSlot={<aside aria-label="Inline ad">Ad</aside>}
        renderNode={renderNode}
      />
    );

    expect(renderNode).toHaveBeenCalledOnce();
    expect(renderNode).toHaveBeenCalledWith(doc, '0', 0);
    expect(
      screen.queryByRole('complementary', { name: 'Inline ad' })
    ).toBeNull();
  });

  it('injects the ad slot with >=340px width-safe classes after the 3rd paragraph', () => {
    const doc: TipTapNode = {
      type: 'doc',
      content: [
        makePara('P1'),
        makePara('P2'),
        makePara('P3'),
        makePara('P4'),
        makePara('P5'),
      ],
    };

    render(
      <BlogDocWithOptionalAd
        doc={doc}
        inArticleAdSlot={<aside aria-label="Inline ad">Ad</aside>}
        renderNode={(node, path) => (
          <p data-path={path}>{node.content?.[0]?.text}</p>
        )}
      />
    );

    const ad = screen.getByRole('complementary', { name: 'Inline ad' });
    expect(ad.parentElement).toHaveClass(
      'not-prose',
      '-mx-6',
      'hidden',
      'min-[340px]:flex',
      'sm:mx-0'
    );
    const p3 = screen.getByText('P3');
    const p4 = screen.getByText('P4');
    expect(
      p3.compareDocumentPosition(ad) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      ad.compareDocumentPosition(p4) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });
});

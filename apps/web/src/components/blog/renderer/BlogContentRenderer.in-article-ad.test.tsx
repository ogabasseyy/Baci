import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/safe-html', () => ({
  SafeHtml: ({
    as: Tag = 'div',
    className,
    html,
  }: {
    as?: 'code' | 'div' | 'span';
    className?: string;
    headingLevelOffset?: number;
    html: string;
  }) => <Tag className={className}>{html}</Tag>,
}));

vi.mock('@/lib/sanitize-core', () => ({
  sanitizeUrl: vi.fn((url: string) => url),
}));

vi.mock('@/lib/sanitize', () => ({
  sanitizeHtml: (html: string) => html,
}));

vi.mock('lowlight', () => {
  const makeTree = (code: string) => ({
    type: 'root',
    children: [{ type: 'text', value: code }],
  });
  return {
    common: {},
    createLowlight: () => ({
      highlight: vi.fn((_lang: string, code: string) => makeTree(code)),
      highlightAuto: vi.fn((code: string) => makeTree(code)),
      registered: vi.fn(() => true),
    }),
  };
});

vi.mock('hast-util-to-html', () => ({
  toHtml: vi.fn((tree: { children: Array<{ value?: string }> }) =>
    tree.children.map((c) => c.value ?? '').join('')
  ),
}));

import { BlogContentRenderer } from './BlogContentRenderer';

interface TipTapNode {
  attrs?: Record<string, unknown>;
  content?: TipTapNode[];
  text?: string;
  type: string;
}

const doc = (...content: TipTapNode[]): TipTapNode => ({
  type: 'doc',
  content,
});

const paragraph = (...content: TipTapNode[]): TipTapNode => ({
  type: 'paragraph',
  content,
});

const textNode = (value: string): TipTapNode => ({
  type: 'text',
  text: value,
});

describe('BlogContentRenderer inArticleAdSlot placement', () => {
  it('inserts the mid-article ad slot once after the 3rd paragraph on long articles', () => {
    render(
      <BlogContentRenderer
        inArticleAdSlot={<aside aria-label="Mid-article ad">Ad</aside>}
        json={doc(
          paragraph(textNode('Paragraph one')),
          paragraph(textNode('Paragraph two')),
          paragraph(textNode('Paragraph three')),
          paragraph(textNode('Paragraph four')),
          paragraph(textNode('Paragraph five'))
        )}
      />
    );

    const thirdPara = screen.getByText('Paragraph three');
    const fourthPara = screen.getByText('Paragraph four');
    const ad = screen.getByRole('complementary', { name: 'Mid-article ad' });

    expect(
      thirdPara.compareDocumentPosition(ad) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      ad.compareDocumentPosition(fourthPara) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('omits the mid-article ad slot on short posts (< 5 blocks)', () => {
    render(
      <BlogContentRenderer
        inArticleAdSlot={<aside aria-label="Mid-article ad">Ad</aside>}
        json={doc(
          paragraph(textNode('Short one')),
          paragraph(textNode('Short two')),
          paragraph(textNode('Short three'))
        )}
      />
    );

    expect(
      screen.queryByRole('complementary', { name: 'Mid-article ad' })
    ).toBeNull();
  });
});

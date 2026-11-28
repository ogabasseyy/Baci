import { describe, expect, it } from 'vitest';
import type { TipTapNode } from './blog-tiptap-node';
import { findInArticleAdInsertIndex } from './find-in-article-ad-insert-index';

const nonEmptyPara = (): TipTapNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text: 'Copy' }],
});

const emptyPara = (): TipTapNode => ({
  type: 'paragraph',
  content: [],
});

describe('findInArticleAdInsertIndex', () => {
  it('returns -1 when no ad slot is provided or fewer than 5 blocks exist', () => {
    const fiveParas = Array.from({ length: 5 }, nonEmptyPara);
    expect(findInArticleAdInsertIndex(fiveParas, false)).toBe(-1);
    expect(findInArticleAdInsertIndex(fiveParas.slice(0, 4), true)).toBe(-1);
    expect(findInArticleAdInsertIndex(undefined, true)).toBe(-1);
  });

  it('skips empty paragraphs and returns the index of the 3rd non-empty paragraph', () => {
    const nodes: TipTapNode[] = [
      nonEmptyPara(),
      emptyPara(),
      nonEmptyPara(),
      nonEmptyPara(),
      nonEmptyPara(),
    ];
    expect(findInArticleAdInsertIndex(nodes, true)).toBe(3);
  });

  it('returns -1 when the 3rd non-empty paragraph is the final block', () => {
    const nodes: TipTapNode[] = [
      emptyPara(),
      emptyPara(),
      nonEmptyPara(),
      nonEmptyPara(),
      nonEmptyPara(),
    ];
    expect(findInArticleAdInsertIndex(nodes, true)).toBe(-1);
  });
});

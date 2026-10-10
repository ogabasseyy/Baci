import { describe, expect, it } from 'vitest';
import { VOID_HTML_ELEMENTS } from './review-handoff-void-elements';

describe('VOID_HTML_ELEMENTS', () => {
  it.each([
    'img',
    'br',
    'hr',
    'source',
    'input',
    'wbr',
  ])('treats %s as void', (tag) => {
    expect(VOID_HTML_ELEMENTS.has(tag)).toBe(true);
  });

  it.each([
    'div',
    'p',
    'span',
    'picture',
    'a',
  ])('treats %s as non-void', (tag) => {
    expect(VOID_HTML_ELEMENTS.has(tag)).toBe(false);
  });
});

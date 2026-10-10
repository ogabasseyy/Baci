import { describe, expect, it } from 'vitest';
import { parseHandoffDom } from './review-handoff-dom';

describe('parseHandoffDom', () => {
  it('parses nesting the way browsers do', () => {
    const doc = parseHandoffDom('<div><p>Body</p></div>');
    expect(doc.querySelector('div > p')?.textContent).toBe('Body');
  });

  it('repairs unclosed tags instead of dropping them', () => {
    const doc = parseHandoffDom('<div><p>Body');
    expect(doc.querySelector('div > p')?.textContent).toBe('Body');
  });

  it('keeps comments out of element queries', () => {
    const doc = parseHandoffDom('<!-- <dialog> --><p>Body</p>');
    expect(doc.querySelector('dialog')).toBeNull();
    expect(doc.querySelector('p')?.textContent).toBe('Body');
  });

  it('normalizes tag and attribute case', () => {
    const doc = parseHandoffDom('<P CLASS="block">Body</P>');
    expect(doc.querySelector('p')?.getAttribute('class')).toBe('block');
  });

  it('exposes valueless attributes to hasAttribute', () => {
    const doc = parseHandoffDom('<div popover>Note</div>');
    expect(doc.querySelector('div')?.hasAttribute('popover')).toBe(true);
  });

  it('separates template contents from the rendered tree', () => {
    // Template subtrees are inert: queries over the document must
    // not see them, matching what the source displayed.
    const doc = parseHandoffDom(
      '<template><dialog><p>Note</p></dialog></template><p>Body</p>'
    );
    expect(doc.querySelector('dialog')).toBeNull();
    expect(doc.querySelector('p')?.textContent).toBe('Body');
  });

  it('promotes noscript children like browsers do', () => {
    // Verified against real Chrome: DOMParser drops the noscript
    // wrapper and promotes its children to siblings, identically in
    // jsdom and the browser. Checks therefore see noscript children
    // exactly as the old tag scanners did; the noscript strip still
    // removes the subtree before sanitization unwraps it.
    const doc = parseHandoffDom('<noscript><p>Note</p></noscript><p>After</p>');
    expect(doc.body.innerHTML).toBe('<p>Note</p><p>After</p>');
  });
});

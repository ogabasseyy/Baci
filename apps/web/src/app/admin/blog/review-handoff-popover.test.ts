import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { hasUnopenedPopover } from './review-handoff-popover';

describe('hasUnopenedPopover', () => {
  it.each([
    '<div popover><p>Draft note</p></div><p>Body</p>',
    '<div popover="auto"><p>Draft note</p></div>',
    '<div popover="manual"><p>Draft note</p></div>',
    '<DIV POPOVER><p>Draft note</p></DIV>',
    '<dialog popover><p>Draft note</p></dialog>',
  ])('flags unopened popovers: %s', (html) => {
    expect(hasUnopenedPopover(html)).toBe(true);
  });

  it.each([
    '<p>Visible article</p>',
    '<div><p>Visible article</p></div>',
    '<button popovertarget="note">Open</button>',
    '<div title="popover demo"><p>Visible</p></div>',
    '<div data-popover="x"><p>Visible</p></div>',
    '<!-- <div popover><p>Note</p></div> --><p>Body</p>',
    '</div>',
  ])('ignores non-popover markup: %s', (html) => {
    expect(hasUnopenedPopover(html)).toBe(false);
  });

  it('rejects an unopened popover note at import', () => {
    expect(() =>
      validateImportedContent('<div popover><p>Draft note</p></div><p>Body</p>')
    ).toThrow('popover markup the editor cannot preserve');
  });
});

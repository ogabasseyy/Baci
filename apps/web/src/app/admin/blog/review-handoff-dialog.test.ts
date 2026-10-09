import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { hasClosedDialog } from './review-handoff-dialog';

describe('hasClosedDialog', () => {
  it('flags a closed dialog hiding body content', () => {
    expect(
      hasClosedDialog('<dialog><p>Draft note</p></dialog><p>Body</p>')
    ).toBe(true);
  });

  it('rejects closed dialog markup at import', () => {
    expect(() =>
      validateImportedContent('<dialog><p>Draft note</p></dialog><p>Body</p>')
    ).toThrow('dialog');
  });

  it('accepts open dialog markup at import', () => {
    expect(
      validateImportedContent('<dialog open><p>Shown</p></dialog><p>Body</p>')
    ).toContain('Shown');
  });

  it.each([
    '<dialog open><p>Shown</p></dialog>',
    '<dialog open=""><p>Shown</p></dialog>',
    '<DIALOG OPEN><p>Shown</p></DIALOG>',
  ])('accepts an open dialog: %s', (html) => {
    expect(hasClosedDialog(html)).toBe(false);
  });

  it('ignores dialog markup inside comments', () => {
    expect(
      hasClosedDialog('<!-- <dialog><p>Note</p></dialog> --><p>Body</p>')
    ).toBe(false);
  });

  it('ignores open lookalikes in names and values', () => {
    expect(hasClosedDialog('<dialog data-open><p>Note</p></dialog>')).toBe(
      true
    );
    expect(
      hasClosedDialog('<dialog title="open sesame"><p>Note</p></dialog>')
    ).toBe(true);
  });

  it('accepts markup without dialogs', () => {
    expect(hasClosedDialog('<p>Body</p>')).toBe(false);
  });
});

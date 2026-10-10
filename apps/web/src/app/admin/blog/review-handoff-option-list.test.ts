import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';
import { hasUnrepresentableOptionList } from './review-handoff-option-list';

describe('hasUnrepresentableOptionList', () => {
  it.each([
    '<datalist><option>Draft note</option></datalist><p>Body</p>',
    '<select><option>Draft note</option></select><p>Body</p>',
    '<select><option value="a">A</option><option value="b" selected>B</option></select><p>Body</p>',
    '<select><optgroup label="G"><option>A</option></optgroup></select><p>Body</p>',
    // Orphaned options render inline in the browser but sanitize
    // away with their text, so they reject like containers.
    '<option>Draft</option><p>Body</p>',
    '<optgroup label="G"><option>A</option></optgroup><p>Body</p>',
  ])('rejects option-list markup at import: %s', (html) => {
    expect(hasUnrepresentableOptionList(html)).toBe(true);
    expect(() => validateImportedContent(html)).toThrow(
      'Article content has option-list markup the editor cannot preserve'
    );
  });

  it('leaves plain articles alone', () => {
    const html = '<p>Body</p>';
    expect(hasUnrepresentableOptionList(html)).toBe(false);
    expect(validateImportedContent(html)).toBe('<p>Body</p>');
  });
});

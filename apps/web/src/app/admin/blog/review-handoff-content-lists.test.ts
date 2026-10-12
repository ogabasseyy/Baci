import { describe, expect, it } from 'vitest';
import { validateImportedContent } from './review-handoff-content';

describe('validateImportedContent ordered lists', () => {
  it('preserves non-default ordered-list start values', () => {
    expect(
      validateImportedContent(
        '<ol start="5"><li>Step five</li><li>Step six</li></ol>'
      )
    ).toContain('start="5"');
  });

  it('preserves alphabetic ordered-list marker types', () => {
    expect(
      validateImportedContent('<ol type="A"><li>First</li><li>Second</li></ol>')
    ).toContain('type="A"');
  });
});

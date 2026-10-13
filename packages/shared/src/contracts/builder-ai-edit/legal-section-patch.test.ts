import { describe, expect, it } from 'vitest';
import { legalSectionPatchSchema } from './legal-section-patch';

describe('legalSectionPatchSchema', () => {
  it('requires unique bounded section headings', () => {
    expect(
      legalSectionPatchSchema.safeParse({
        componentType: 'LegalSection',
        sections: [{ content: 'We protect data.', heading: 'Privacy' }],
      }).success
    ).toBe(true);
    expect(
      legalSectionPatchSchema.safeParse({
        componentType: 'LegalSection',
        sections: [
          { content: 'First.', heading: 'Privacy' },
          { content: 'Second.', heading: 'Privacy' },
        ],
      }).success
    ).toBe(false);
  });
});

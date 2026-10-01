import { describe, expect, it } from 'vitest';
import { manifestBuilderAiCapability } from './validate-manifest-capability';

describe('manifest builder AI capability validation', () => {
  it('rejects props outside the manifest contract', () => {
    expect(
      manifestBuilderAiCapability.isComponentPatch({
        componentType: 'Button',
        link: 'javascript:alert(1)',
      })
    ).toBe(false);
    expect(
      manifestBuilderAiCapability.isComponentPatch({
        componentType: 'FAQ',
        items: Array.from({ length: 13 }, (_, index) => ({
          answer: `Answer ${index}`,
          question: `Question ${index}`,
        })),
      })
    ).toBe(false);
    expect(
      manifestBuilderAiCapability.isComponentPatch({
        componentType: 'LegalSection',
        sections: [
          { content: 'One', heading: 'Privacy' },
          { content: 'Two', heading: 'Privacy' },
        ],
      })
    ).toBe(false);
  });

  it('allows only real content zones and rejects root or unknown destinations', () => {
    const collections = ['content', 'aside'];

    expect(
      manifestBuilderAiCapability.isInsertPlacement(
        'Text',
        'aside',
        collections
      )
    ).toBe(true);
    expect(
      manifestBuilderAiCapability.isInsertPlacement('Text', 'root', collections)
    ).toBe(false);
    expect(
      manifestBuilderAiCapability.isInsertPlacement(
        'Text',
        'unknown-zone',
        collections
      )
    ).toBe(false);
    expect(
      manifestBuilderAiCapability.isInsertPlacement(
        'Header',
        'aside',
        collections
      )
    ).toBe(false);
  });
});

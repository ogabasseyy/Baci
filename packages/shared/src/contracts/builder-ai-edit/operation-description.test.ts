import { describe, expect, it } from 'vitest';
import { describeBuilderAiOperation } from './operation-description';

describe('builder AI edit operation descriptions', () => {
  it('labels the operation without exposing raw copy or URLs', () => {
    expect(
      describeBuilderAiOperation({
        componentId: 'hero-1',
        kind: 'update_component',
        patch: {
          componentType: 'Hero',
          ctaLink: 'https://private.example.test',
          title: 'Confidential copy',
        },
      })
    ).toBe('Update Hero text');
  });

  it('uses an allowlisted target type for structural labels', () => {
    expect(
      describeBuilderAiOperation(
        {
          componentId: 'newsletter-1',
          destination: { position: 'first_content' },
          kind: 'move_component',
        },
        'Newsletter'
      )
    ).toBe('Move Newsletter');
    expect(
      describeBuilderAiOperation(
        { componentId: 'x', kind: 'remove_component' },
        'CodeEmbed'
      )
    ).toBe('Remove component');
  });
});

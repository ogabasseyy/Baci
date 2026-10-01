import type {
  BuilderAiProposedPlan,
  BuilderData,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { applyBuilderAiEditPlan } from './apply-builder-ai-edit-plan';

const config: BuilderData = {
  content: [
    { props: { id: 'header' }, type: 'Header' },
    { props: { id: 'grid' }, type: 'ProductGrid' },
  ],
  root: { title: 'Home' },
};

function plan(operation: unknown): BuilderAiProposedPlan {
  return {
    operations: [operation] as BuilderAiProposedPlan['operations'],
    status: 'proposed',
    summary: 'Apply verified catalog values',
  };
}

describe('applyBuilderAiEditPlan catalog parity', () => {
  it.each([
    ['layout', 'logo-left-nav-center'],
    ['layout', 'logo-left-nav-right'],
    ['layout', 'logo-center'],
    ['paddingY', 'sm'],
    ['paddingY', 'md'],
    ['paddingY', 'lg'],
    ['searchRadius', 'none'],
    ['searchRadius', 'sm'],
    ['searchRadius', 'md'],
    ['searchRadius', 'full'],
    ['searchStyle', 'outline'],
    ['searchStyle', 'filled'],
    ['searchStyle', 'minimal'],
  ])('applies the Puck Header %s value %s', (property, value) => {
    const result = applyBuilderAiEditPlan(
      config,
      plan({
        componentId: 'header',
        kind: 'update_component',
        patch: { componentType: 'Header', [property]: value },
      })
    );

    expect(result.candidateConfig.content[0].props[property]).toBe(value);
  });

  it('allows replacing the only ProductGrid with a default-only insert', () => {
    const result = applyBuilderAiEditPlan(
      config,
      {
        operations: [
          { componentId: 'grid', kind: 'remove_component' },
          {
            initialContent: { componentType: 'ProductGrid' },
            kind: 'insert_component',
            placement: { position: 'first_content' },
          },
        ],
        status: 'proposed',
        summary: 'Replace the product grid',
      } as BuilderAiProposedPlan,
      () => 'replacement-grid'
    );

    expect(result.candidateConfig.content.map((item) => item.props.id)).toEqual(
      ['header', 'replacement-grid']
    );
  });

  it('applies a Features update using the real default registry icon', () => {
    const result = applyBuilderAiEditPlan(
      {
        content: [{ props: { id: 'features' }, type: 'Features' }],
        root: { title: 'Home' },
      },
      plan({
        componentId: 'features',
        kind: 'update_component',
        patch: {
          componentType: 'Features',
          features: [
            {
              description: 'Available help when needed.',
              icon: 'headphones',
              title: 'Support',
            },
          ],
        },
      })
    );

    expect(result.candidateConfig.content[0].props.features).toEqual([
      {
        description: 'Available help when needed.',
        icon: 'headphones',
        title: 'Support',
      },
    ]);
  });
});

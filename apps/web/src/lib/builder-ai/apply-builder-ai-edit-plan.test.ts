import type {
  BuilderAiProposedPlan,
  BuilderData,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { applyBuilderAiEditPlan } from './apply-builder-ai-edit-plan';

const config: BuilderData = {
  content: [{ props: { id: 'text', title: 'Same' }, type: 'Text' }],
  root: { title: 'Home' },
};

const structuredConfig: BuilderData = {
  content: [
    {
      props: {
        features: [
          { description: 'Fast shipping', icon: 'truck', title: 'Delivery' },
        ],
        id: 'features',
      },
      type: 'Features',
    },
    {
      props: {
        ctaButton: { show: true, text: 'Shop', url: '/products' },
        id: 'header',
      },
      type: 'Header',
    },
  ],
  root: { title: 'Home' },
};

function plan(operation: unknown): BuilderAiProposedPlan {
  return {
    operations: [operation] as BuilderAiProposedPlan['operations'],
    status: 'proposed',
    summary: 'No-op behavior',
  };
}

describe('applyBuilderAiEditPlan no-op behavior', () => {
  it('keeps plan order for components inserted after the same target', () => {
    const result = applyBuilderAiEditPlan(
      {
        content: [{ props: { id: 'hero' }, type: 'Hero' }],
        root: { title: 'Home' },
      },
      {
        operations: [
          {
            initialContent: { componentType: 'Text', title: 'First' },
            kind: 'insert_component',
            placement: { componentId: 'hero', position: 'after' },
          },
          {
            initialContent: { componentType: 'Newsletter', title: 'Second' },
            kind: 'insert_component',
            placement: { componentId: 'hero', position: 'after' },
          },
        ],
        status: 'proposed',
        summary: 'Add adjacent sections',
      } as BuilderAiProposedPlan,
      (type) => `new-${type}`
    );

    expect(result.candidateConfig.content.map((item) => item.type)).toEqual([
      'Hero',
      'Text',
      'Newsletter',
    ]);
  });

  it('updates an editable component stored in a zone', () => {
    const zonedConfig: BuilderData = {
      content: [],
      root: { title: 'Home' },
      zones: {
        aside: [{ props: { id: 'zone-text', title: 'Before' }, type: 'Text' }],
      },
    };

    const result = applyBuilderAiEditPlan(
      zonedConfig,
      plan({
        componentId: 'zone-text',
        kind: 'update_component',
        patch: { componentType: 'Text', title: 'After' },
      })
    );

    expect(result.candidateConfig.zones).toMatchObject({
      aside: [{ props: { id: 'zone-text', title: 'After' }, type: 'Text' }],
    });
  });

  it.each([
    [
      {
        componentId: 'text',
        kind: 'update_component',
        patch: { componentType: 'Text', title: 'Same' },
      },
      'No safe changes for Text.',
    ],
    [{ kind: 'update_root', title: 'Home' }, 'No safe changes for page title.'],
  ])('reports %s as a bounded warning', (operation, warning) => {
    expect(applyBuilderAiEditPlan(config, plan(operation)).warnings).toContain(
      warning
    );
  });

  it.each([
    [
      {
        componentId: 'features',
        kind: 'update_component',
        patch: {
          componentType: 'Features',
          features: [
            {
              description: 'Fast shipping',
              icon: 'truck',
              title: 'Delivery',
            },
          ],
        },
      },
      'No safe changes for Features.',
    ],
    [
      {
        componentId: 'header',
        kind: 'update_component',
        patch: {
          componentType: 'Header',
          ctaButton: { show: true, text: 'Shop', url: '/products' },
        },
      },
      'No safe changes for Header.',
    ],
  ])('warns without assigning a semantically identical structured patch', (operation, warning) => {
    const result = applyBuilderAiEditPlan(structuredConfig, plan(operation));

    expect(result.candidateConfig).toEqual(structuredConfig);
    expect(result.warnings).toContain(warning);
  });

  it('keeps a Testimonial zero rating unchanged for a signed-zero patch', () => {
    // Arrange
    const testimonialConfig: BuilderData = {
      content: [
        { props: { id: 'testimonial', rating: 0 }, type: 'Testimonial' },
      ],
      root: { title: 'Home' },
    };
    const signedZeroPlan = plan({
      componentId: 'testimonial',
      kind: 'update_component',
      patch: { componentType: 'Testimonial', rating: -0 },
    });

    // Act
    const result = applyBuilderAiEditPlan(testimonialConfig, signedZeroPlan);

    // Assert
    expect(result.candidateConfig).toEqual(testimonialConfig);
    expect(result.warnings).toContain('No safe changes for Testimonial.');
    expect(Object.is(result.candidateConfig.content[0]?.props.rating, -0)).toBe(
      false
    );
  });
});

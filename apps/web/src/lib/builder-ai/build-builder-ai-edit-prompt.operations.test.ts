import type { BuilderAiProposedPlan } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { applyBuilderAiEditPlan } from './apply-builder-ai-edit-plan';
import { buildBuilderAiEditPrompt } from './build-builder-ai-edit-prompt';

function getOperationGuide(prompt: string): Record<string, unknown> {
  return JSON.parse(
    prompt.match(/<operation-guide>(.+)<\/operation-guide>/)?.[1] ?? ''
  ) as Record<string, unknown>;
}

describe('buildBuilderAiEditPrompt operation guidance', () => {
  it('reads a bounded current root title from Puck root props', () => {
    const prompt = buildBuilderAiEditPrompt({
      currentConfig: {
        content: [],
        root: { props: { apiKey: 'root-secret', title: 'Curated homepage' } },
      },
      prompt: 'Append Sale to the current page title',
    });
    const guide = getOperationGuide(prompt) as {
      currentState: { root: { title?: string } };
    };

    expect(guide.currentState.root.title).toBe('Curated homepage');
    expect(prompt).not.toContain('root-secret');
  });

  it('publishes the exact update_theme contract for schema-less providers', () => {
    const guide = getOperationGuide(
      buildBuilderAiEditPrompt({
        currentConfig: { content: [], root: { title: 'Home' } },
        prompt: 'Use a luxury theme with a blue primary color',
      })
    ) as { updateThemeOperation: Record<string, unknown> };

    expect(guide.updateThemeOperation).toEqual({
      colors: {
        allowedKeys: [
          'primary',
          'secondary',
          'accent',
          'background',
          'foreground',
        ],
        minimumProperties: 1,
        valuePattern: '#RRGGBB',
      },
      kind: 'update_theme',
      preset: {
        allowedValues: [
          'modern',
          'minimal',
          'luxury',
          'playful',
          'bold',
          'calm',
        ],
      },
      requiresAtLeastOneOf: ['preset', 'colors'],
    });
  });

  it('publishes bounded fields for carousel and root-only operations', () => {
    const guide = getOperationGuide(
      buildBuilderAiEditPrompt({
        currentConfig: { content: [], root: { title: 'Home' } },
        prompt: 'Update the slide and page title',
      })
    ) as { specialOperations: Record<string, unknown> };

    expect(guide.specialOperations).toEqual({
      updateCarouselSlide: {
        ctaLink: { maximumLength: 512, type: 'safe-link' },
        ctaText: { maximumLength: 120, required: true, type: 'string' },
        mediaMutation: {
          message: 'Requires an asset pipeline review.',
          refusalCode: 'media-review',
        },
        subtitle: { maximumLength: 2000, type: 'string' },
        title: { maximumLength: 120, required: true, type: 'string' },
      },
      updateRoot: { title: { maximumLength: 120 } },
    });
  });

  it('publishes every aggregate model-plan limit for schema-less providers', () => {
    const guide = getOperationGuide(
      buildBuilderAiEditPrompt({
        currentConfig: { content: [], root: { title: 'Home' } },
        prompt: 'Add several sections',
      })
    ) as { aggregatePlanLimits: Record<string, number> };

    expect(guide.aggregatePlanLimits).toEqual({
      maxInserts: 5,
      maxOperations: 20,
      maxSerializedUtf8Bytes: 4096,
      maxSummaryOrRefusalReasonChars: 240,
    });
  });

  it('keeps non-editable component ids as placement-only anchors', () => {
    const prompt = buildBuilderAiEditPrompt({
      currentConfig: {
        content: [
          {
            props: {
              id: 'image-anchor',
              src: 'https://private.test/image.jpg',
            },
            type: 'Image',
          },
        ],
        root: { title: 'Home' },
      },
      prompt: 'Add text after the image',
    });
    const components = JSON.parse(
      prompt.match(/<safe-components>(.+)<\/safe-components>/)?.[1] ?? ''
    ) as Record<string, unknown>[];

    expect(components).toContainEqual({
      collection: 'content',
      id: 'image-anchor',
      type: 'Image',
    });
    expect(prompt).not.toContain('private.test');
  });

  it('publishes a move-after example that can reorder two components', () => {
    const guide = getOperationGuide(
      buildBuilderAiEditPrompt({
        currentConfig: { content: [], root: { title: 'Home' } },
        prompt: 'Move the text after the hero',
      })
    ) as { operationExamples: BuilderAiProposedPlan['operations'] };
    const moveAfter = guide.operationExamples.find(
      (operation) =>
        operation.kind === 'move_component' &&
        operation.destination.position === 'after'
    );
    const insertAfter = guide.operationExamples.find(
      (operation) =>
        operation.kind === 'insert_component' &&
        operation.placement.position === 'after'
    );

    if (!moveAfter) throw new Error('Expected an after move example');
    if (!insertAfter) throw new Error('Expected an after insert example');
    expect(insertAfter).toEqual({
      initialContent: { componentType: 'Text', content: 'Supporting copy' },
      kind: 'insert_component',
      placement: { componentId: 'component-id', position: 'after' },
    });
    expect(moveAfter).toEqual({
      componentId: 'source-component-id',
      destination: { componentId: 'anchor-component-id', position: 'after' },
      kind: 'move_component',
    });

    const result = applyBuilderAiEditPlan(
      {
        content: [
          { props: { id: 'source-component-id' }, type: 'Text' },
          { props: { id: 'anchor-component-id' }, type: 'Text' },
        ],
        root: { title: 'Home' },
      },
      { operations: [moveAfter], status: 'proposed', summary: 'Move text' }
    );

    expect(result.candidateConfig.content.map((item) => item.props.id)).toEqual(
      ['anchor-component-id', 'source-component-id']
    );
  });

  it('publishes a named collection for first-content zone placements', () => {
    const guide = getOperationGuide(
      buildBuilderAiEditPrompt({
        currentConfig: { content: [], root: { title: 'Home' } },
        prompt: 'Add text to the sidebar',
      })
    ) as { operationExamples: BuilderAiProposedPlan['operations'] };

    expect(guide.operationExamples).toContainEqual({
      initialContent: { componentType: 'Text', content: 'Supporting copy' },
      kind: 'insert_component',
      placement: { collection: 'content', position: 'first_content' },
    });
  });
});

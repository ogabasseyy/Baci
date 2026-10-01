import type {
  BuilderAiProposedPlan,
  BuilderData,
} from '@baci/shared/contracts';
import {
  MAX_AI_PLAN_OPERATIONS,
  MAX_BUILDER_DATA_DEPTH,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import {
  applyBuilderAiEditPlan,
  BuilderAiEditPlanError,
} from './apply-builder-ai-edit-plan';

const config: BuilderData = {
  content: [
    { props: { id: 'header' }, type: 'Header' },
    { props: { id: 'hero', title: 'Original' }, type: 'Hero' },
    { props: { id: 'footer' }, type: 'Footer' },
  ],
  root: { title: 'Home' },
};

function plan(
  operations: BuilderAiProposedPlan['operations']
): BuilderAiProposedPlan {
  return { operations, status: 'proposed', summary: 'Safe request' };
}

function nest(value: unknown, depth: number): unknown {
  let nested = value;
  for (let index = 0; index < depth; index += 1) {
    nested = { nested };
  }
  return nested;
}

describe('applyBuilderAiEditPlan raw media boundaries', () => {
  it.each([
    'backgroundImage',
    'source',
    'src',
  ])('warns for raw media key %s without changing the candidate', (mediaKey) => {
    const result = applyBuilderAiEditPlan(
      config,
      plan([
        {
          componentId: 'hero',
          kind: 'update_component',
          patch: {
            [mediaKey]: 'https://example.test/private.jpg',
            componentType: 'Hero',
          },
        },
      ] as unknown as BuilderAiProposedPlan['operations'])
    );

    expect(result.candidateConfig).toEqual(config);
    expect(result.warnings).toEqual([
      'Media changes require Baci manual asset controls.',
    ]);
  });

  it.each([
    {
      componentId: 'carousel',
      image: 'https://example.test/private.jpg',
      kind: 'update_carousel_slide',
    },
    {
      componentId: 'hero',
      kind: 'update_component',
      patch: {
        componentType: 'Hero',
        nested: { source: 'https://example.test/private.jpg' },
      },
    },
  ])('warns for media in every raw operation shape', (operation) => {
    const result = applyBuilderAiEditPlan(
      config,
      plan([operation] as unknown as BuilderAiProposedPlan['operations'])
    );

    expect(result.candidateConfig).toEqual(config);
    expect(result.warnings).toEqual([
      'Media changes require Baci manual asset controls.',
    ]);
  });

  it('validates the unchanged candidate before returning a media warning', () => {
    const duplicateConfig: BuilderData = {
      ...config,
      content: [...config.content, { props: { id: 'hero' }, type: 'Text' }],
    };

    expect(() =>
      applyBuilderAiEditPlan(
        duplicateConfig,
        plan([
          {
            componentId: 'hero',
            kind: 'update_component',
            patch: {
              backgroundImage: 'https://example.test/private.jpg',
              componentType: 'Hero',
            },
          },
        ] as unknown as BuilderAiProposedPlan['operations'])
      )
    ).toThrow('Duplicate component id');
  });

  it('rejects over-depth raw media through the stable edit-plan error', () => {
    expect(() =>
      applyBuilderAiEditPlan(
        config,
        plan([
          {
            componentId: 'hero',
            kind: 'update_component',
            patch: {
              componentType: 'Hero',
              nested: nest(
                { source: 'https://example.test/private.jpg' },
                MAX_BUILDER_DATA_DEPTH + 1
              ),
            },
          },
        ] as unknown as BuilderAiProposedPlan['operations'])
      )
    ).toThrow(BuilderAiEditPlanError);
  });

  it('returns a manual-controls warning for in-budget carousel media', () => {
    const result = applyBuilderAiEditPlan(
      config,
      plan([
        {
          componentId: 'carousel',
          image: 'https://example.test/private.jpg',
          kind: 'update_carousel_slide',
          nested: nest({}, MAX_BUILDER_DATA_DEPTH - 3),
        },
      ] as unknown as BuilderAiProposedPlan['operations'])
    );

    expect(result.candidateConfig).toEqual(config);
    expect(result.warnings).toEqual([
      'Media changes require Baci manual asset controls.',
    ]);
  });

  it('rejects an over-operation raw media envelope through the stable error', () => {
    expect(() =>
      applyBuilderAiEditPlan(
        config,
        plan(
          Array.from({ length: MAX_AI_PLAN_OPERATIONS + 1 }, () => ({
            componentId: 'hero',
            kind: 'update_component',
            patch: {
              componentType: 'Hero',
              source: 'https://example.test/private.jpg',
            },
          })) as unknown as BuilderAiProposedPlan['operations']
        )
      )
    ).toThrow(BuilderAiEditPlanError);
  });
});

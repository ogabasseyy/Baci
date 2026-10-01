import {
  MAX_AI_PLAN_OPERATIONS,
  MAX_BUILDER_ARRAY_ITEMS,
  MAX_BUILDER_DATA_DEPTH,
} from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getBuilderAiRawPlanMediaWarning } from './get-builder-ai-raw-plan-media-warning';

function nest(value: unknown, depth: number): unknown {
  let nested = value;
  for (let index = 0; index < depth; index += 1) {
    nested = { nested };
  }
  return nested;
}

describe('getBuilderAiRawPlanMediaWarning', () => {
  it('classifies media and source fields before strict model-plan parsing', () => {
    expect(
      getBuilderAiRawPlanMediaWarning({
        operations: [
          { kind: 'update_component', patch: { source: 'asset-id' } },
        ],
      })
    ).toBe('Media changes require Baci manual asset controls.');
  });

  it('does not classify ordinary copy fields as a media attempt', () => {
    expect(
      getBuilderAiRawPlanMediaWarning({
        operations: [{ kind: 'update_component', patch: { title: 'New' } }],
      })
    ).toBeUndefined();
  });

  it('classifies carousel and nested media fields in every raw operation shape', () => {
    expect(
      getBuilderAiRawPlanMediaWarning({
        operations: [
          {
            componentId: 'carousel',
            image: 'asset-id',
            kind: 'update_carousel_slide',
          },
        ],
      })
    ).toBe('Media changes require Baci manual asset controls.');
    expect(
      getBuilderAiRawPlanMediaWarning({
        operations: [
          {
            kind: 'update_component',
            patch: { componentType: 'Hero', nested: { source: 'asset-id' } },
          },
        ],
      })
    ).toBe('Media changes require Baci manual asset controls.');
  });

  it('keeps in-budget media but defers over-budget raw plans to the closed schema', () => {
    expect(
      getBuilderAiRawPlanMediaWarning({
        operations: [
          {
            componentId: 'carousel',
            image: 'asset-id',
            kind: 'update_carousel_slide',
            nested: nest({}, MAX_BUILDER_DATA_DEPTH - 3),
          },
        ],
      })
    ).toBe('Media changes require Baci manual asset controls.');
    expect(
      getBuilderAiRawPlanMediaWarning({
        operations: [
          {
            componentId: 'hero',
            kind: 'update_component',
            patch: {
              componentType: 'Hero',
              nested: nest({ source: 'asset-id' }, MAX_BUILDER_DATA_DEPTH + 1),
            },
          },
        ],
      })
    ).toBeUndefined();
    expect(
      getBuilderAiRawPlanMediaWarning({
        operations: Array.from({ length: MAX_AI_PLAN_OPERATIONS + 1 }, () => ({
          kind: 'update_component',
          source: 'asset-id',
        })),
      })
    ).toBeUndefined();
    expect(
      getBuilderAiRawPlanMediaWarning({
        operations: [
          {
            componentId: 'hero',
            kind: 'update_component',
            patch: { componentType: 'Hero', source: 'asset-id' },
            wide: Object.fromEntries(
              Array.from(
                {
                  length: MAX_AI_PLAN_OPERATIONS * MAX_BUILDER_ARRAY_ITEMS + 1,
                },
                (_, index) => [String(index), {}]
              )
            ),
          },
        ],
      })
    ).toBeUndefined();
  });

  it('keeps cyclic raw media plans stack-safe', () => {
    const patch: Record<string, unknown> = {
      componentType: 'Hero',
      source: 'asset-id',
    };
    patch.self = patch;

    expect(
      getBuilderAiRawPlanMediaWarning({
        operations: [{ componentId: 'hero', kind: 'update_component', patch }],
      })
    ).toBe('Media changes require Baci manual asset controls.');
  });
});

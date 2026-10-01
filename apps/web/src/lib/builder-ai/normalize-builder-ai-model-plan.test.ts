import { describe, expect, it } from 'vitest';
import { normalizeBuilderAiModelPlan } from './normalize-builder-ai-model-plan';

describe('normalizeBuilderAiModelPlan', () => {
  it('removes only model-selected ids from insert content before schema validation', () => {
    expect(
      normalizeBuilderAiModelPlan({
        operations: [
          {
            initialContent: {
              componentType: 'Text',
              id: 'model-id',
              title: 'Safe',
            },
            kind: 'insert_component',
          },
        ],
      })
    ).toEqual({
      operations: [
        {
          initialContent: { componentType: 'Text', title: 'Safe' },
          kind: 'insert_component',
        },
      ],
    });
  });
});

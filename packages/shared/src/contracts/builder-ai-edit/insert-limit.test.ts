import { describe, expect, it } from 'vitest';
import {
  builderAiEditCandidateSchema,
  builderAiModelPlanSchema,
} from './index';
import { MAX_AI_PLAN_INSERTS } from './limits';

function insertOperations(count: number) {
  return Array.from({ length: count }, () => ({
    initialContent: { componentType: 'Text', content: 'A safe note' },
    kind: 'insert_component',
    placement: { position: 'first_content' },
  }));
}

describe('builder AI edit insert limit', () => {
  it('keeps model plans at the shared insertion boundary', () => {
    expect(
      builderAiModelPlanSchema.safeParse({
        operations: insertOperations(MAX_AI_PLAN_INSERTS),
        status: 'proposed',
        summary: 'Add supporting copy',
      }).success
    ).toBe(true);
    expect(
      builderAiModelPlanSchema.safeParse({
        operations: insertOperations(MAX_AI_PLAN_INSERTS + 1),
        status: 'proposed',
        summary: 'Add supporting copy',
      }).success
    ).toBe(false);
  });

  it('keeps candidates at the same shared insertion boundary', () => {
    const candidate = {
      candidateConfig: { content: [], root: { title: 'Home' } },
      clientRequestId: '00000000-0000-4000-8000-000000000001',
      contractVersion: 'builder-ai-edit-v1',
      summary: 'Add supporting copy',
      warnings: [],
    };

    expect(
      builderAiEditCandidateSchema.safeParse({
        ...candidate,
        operations: insertOperations(MAX_AI_PLAN_INSERTS),
      }).success
    ).toBe(true);
    expect(
      builderAiEditCandidateSchema.safeParse({
        ...candidate,
        operations: insertOperations(MAX_AI_PLAN_INSERTS + 1),
      }).success
    ).toBe(false);
  });
});

import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { describe, expect, it } from 'vitest';
import { parseBuilderAiEditCandidate } from './parse-builder-ai-edit-candidate';

describe('parseBuilderAiEditCandidate', () => {
  it('rejects candidate fields outside the shared response contract', () => {
    expect(() =>
      parseBuilderAiEditCandidate({
        ...builderAiEditTestFixture.candidate,
        extra: true,
      })
    ).toThrow();
  });
});

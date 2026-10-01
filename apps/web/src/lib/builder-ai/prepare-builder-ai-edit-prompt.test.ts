import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as promptBuilder from './build-builder-ai-edit-prompt';
import { prepareBuilderAiEditPrompt } from './prepare-builder-ai-edit-prompt';

describe('prepareBuilderAiEditPrompt', () => {
  afterEach(() => vi.restoreAllMocks());
  it('maps projection safety failures to a stable client-safe result', () => {
    expect(
      prepareBuilderAiEditPrompt({
        currentConfig: {
          ...builderAiEditTestFixture.request.currentConfig,
          content: Array.from({ length: 101 }, (_, index) => ({
            props: { id: `hero-${index}`, title: 'Title' },
            type: 'Hero',
          })),
        },
        prompt: 'Update the hero',
      })
    ).toEqual({
      code: 'builder_ai_prompt_too_large',
      error: 'Builder AI request is too large',
      ok: false,
    });
  });

  it('rethrows unexpected prompt construction failures instead of reporting them as request-size errors', () => {
    vi.spyOn(promptBuilder, 'buildBuilderAiEditPrompt').mockImplementation(
      () => {
        throw new Error('sanitizer invariant failed');
      }
    );

    expect(() =>
      prepareBuilderAiEditPrompt({
        currentConfig: builderAiEditTestFixture.request.currentConfig,
        prompt: 'Update the hero',
      })
    ).toThrow('sanitizer invariant failed');
  });
});

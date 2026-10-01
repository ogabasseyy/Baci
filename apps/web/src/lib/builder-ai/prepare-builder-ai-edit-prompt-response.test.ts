import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as promptPreparation from './prepare-builder-ai-edit-prompt';
import { prepareBuilderAiEditPromptResponse } from './prepare-builder-ai-edit-prompt-response';

describe('prepareBuilderAiEditPromptResponse', () => {
  afterEach(() => vi.restoreAllMocks());

  it('returns a redacted 500 for an unexpected prompt construction error', async () => {
    vi.spyOn(
      promptPreparation,
      'prepareBuilderAiEditPrompt'
    ).mockImplementation(() => {
      throw new Error('internal sanitizer detail');
    });

    const result = prepareBuilderAiEditPromptResponse({
      currentConfig: builderAiEditTestFixture.request.currentConfig,
      prompt: 'Update the hero',
      requestId: 'request-1',
    });

    expect('response' in result).toBe(true);
    if (!('response' in result)) return;
    expect(result.response.status).toBe(500);
    await expect(result.response.json()).resolves.toEqual({
      error: 'Internal server error',
      requestId: 'request-1',
    });
  });
});

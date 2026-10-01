import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { describe, expect, it } from 'vitest';
import { buildBuilderAiEditRequest } from './build-builder-ai-edit-request';

describe('buildBuilderAiEditRequest', () => {
  it('adds the shared contract version to a valid mobile request', () => {
    expect(
      buildBuilderAiEditRequest({
        clientRequestId: builderAiEditTestFixture.request.clientRequestId,
        currentConfig: builderAiEditTestFixture.request.currentConfig,
        merchantId: builderAiEditTestFixture.request.merchantId,
        prompt: builderAiEditTestFixture.request.prompt,
      })
    ).toEqual(builderAiEditTestFixture.request);
  });
});

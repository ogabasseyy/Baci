import { describe, expect, it } from 'vitest';
import { createBuilderAiProviderErrorResponse } from './create-builder-ai-provider-error-response';

describe('createBuilderAiProviderErrorResponse', () => {
  it.each([
    ['ai_builder_invalid_output', 502],
    ['ai_provider_rate_limited', 429],
    ['ai_provider_unavailable', 503],
  ])('maps %s to its public status', async (code, status) => {
    const response = createBuilderAiProviderErrorResponse(
      { code },
      'request-id'
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ code, requestId: 'request-id' })
    );
  });

  it('keeps readable retry guidance in rate-limit details for legacy callers', async () => {
    const response = createBuilderAiProviderErrorResponse(
      { code: 'ai_provider_rate_limited' },
      'request-id'
    );

    await expect(response.json()).resolves.toMatchObject({
      details: 'AI editing is rate limited right now. Please try again later.',
    });
  });
});

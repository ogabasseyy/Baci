import { describe, expect, it } from 'vitest';
import { createBuilderAiRateLimitResponse } from './create-builder-ai-rate-limit-response';

describe('createBuilderAiRateLimitResponse', () => {
  it('preserves retry guidance for legacy clients without adding it to v1', async () => {
    const legacy = createBuilderAiRateLimitResponse('legacy', 'legacy-request');
    const v1 = createBuilderAiRateLimitResponse('v1', 'v1-request');

    expect(legacy.status).toBe(429);
    await expect(legacy.json()).resolves.toMatchObject({
      details: 'Rate limit exceeded. Please try again later.',
      requestId: 'legacy-request',
    });
    await expect(v1.json()).resolves.not.toHaveProperty('details');
  });
});

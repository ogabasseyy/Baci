import { describe, expect, it } from 'vitest';
import { builderAiEditRequestSchema } from './builder-ai-edit-request';

describe('builderAiEditRequestSchema', () => {
  const request = {
    clientRequestId: '00000000-0000-4000-8000-000000000001',
    contractVersion: 'builder-ai-edit-v1',
    currentConfig: { content: [], root: { title: 'Home' } },
    merchantId: '11111111-1111-4111-8111-111111111111',
    prompt: 'Update the title',
  };

  it('accepts the versioned request envelope and rejects unknown fields', () => {
    expect(builderAiEditRequestSchema.safeParse(request).success).toBe(true);
    expect(
      builderAiEditRequestSchema.safeParse({ ...request, unexpected: true })
        .success
    ).toBe(false);
  });
});

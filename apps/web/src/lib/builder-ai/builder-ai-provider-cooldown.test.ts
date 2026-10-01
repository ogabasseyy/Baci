import { describe, expect, it } from 'vitest';
import { builderAiProviderCooldown } from './builder-ai-provider-cooldown';

describe('builderAiProviderCooldown', () => {
  it('parks only a rate-limited provider and keeps cooldown state bounded by provider identity', () => {
    builderAiProviderCooldown.resetForTests();
    builderAiProviderCooldown.recordFailure('cerebras:gemma-4-31b', {
      statusCode: 429,
    });

    expect(
      builderAiProviderCooldown.isCoolingDown('cerebras:gemma-4-31b')
    ).toBe(true);
    expect(
      builderAiProviderCooldown.isCoolingDown('groq:openai/gpt-oss-120b')
    ).toBe(false);
  });
});

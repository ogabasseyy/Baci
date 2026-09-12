import { describe, expect, it } from 'vitest';
import { hasCanonicalBuilderAiProviderOrder } from './has-canonical-builder-ai-provider-order';

describe('hasCanonicalBuilderAiProviderOrder', () => {
  it('accepts the reliable pair and optional opportunistic tail only', () => {
    const reliablePair = [
      { name: 'google:gemma-4-31b-it' },
      { name: 'groq:openai/gpt-oss-120b' },
    ];

    expect(hasCanonicalBuilderAiProviderOrder(reliablePair)).toBe(true);
    expect(
      hasCanonicalBuilderAiProviderOrder([
        ...reliablePair,
        {
          name: 'openrouter:google/gemma-4-31b-it:free',
          opportunistic: true,
        },
      ])
    ).toBe(true);
    expect(
      hasCanonicalBuilderAiProviderOrder([
        { name: 'groq:openai/gpt-oss-120b' },
        { name: 'google:gemma-4-31b-it' },
      ])
    ).toBe(false);
    expect(
      hasCanonicalBuilderAiProviderOrder([
        ...reliablePair,
        { name: 'openrouter:google/gemma-4-31b-it:free' },
      ])
    ).toBe(false);
    expect(
      hasCanonicalBuilderAiProviderOrder([
        ...reliablePair,
        { name: 'openrouter:other-model', opportunistic: true },
      ])
    ).toBe(false);
    expect(
      hasCanonicalBuilderAiProviderOrder([
        ...reliablePair,
        {
          name: 'openrouter:google/gemma-4-31b-it:free',
          opportunistic: true,
        },
        { name: 'extra:provider' },
      ])
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { builderAiJsonTransportContract } from './builder-ai-json-transport-contract';

describe('builder AI JSON transport contract', () => {
  it('requires both reliable providers in canonical order', () => {
    expect(
      builderAiJsonTransportContract.hasCanonicalProviderOrder([
        { name: 'google:gemma-4-31b-it' },
        { name: 'groq:openai/gpt-oss-120b' },
      ])
    ).toBe(true);
    expect(
      builderAiJsonTransportContract.hasCanonicalProviderOrder([
        { name: 'google:gemma-4-31b-it' },
        { name: 'groq:openai/gpt-oss-120b' },
        {
          name: 'openrouter:google/gemma-4-31b-it:free',
          opportunistic: true,
        },
      ])
    ).toBe(true);
  });

  it('rejects zero providers, reordered links, incomplete chains, and unpinned models', () => {
    for (const providers of [
      [],
      [{ name: 'google:gemma-4-31b-it' }],
      [
        { name: 'groq:openai/gpt-oss-120b' },
        { name: 'google:gemma-4-31b-it' },
      ],
      [{ name: 'google:gemini-2.5-flash' }],
      [{ name: 'openrouter:free', opportunistic: true }],
    ]) {
      expect(
        builderAiJsonTransportContract.hasCanonicalProviderOrder(providers)
      ).toBe(false);
    }
  });
});

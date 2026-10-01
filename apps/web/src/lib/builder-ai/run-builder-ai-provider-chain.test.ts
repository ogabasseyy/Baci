import { builderAiEditTestFixture } from '@baci/shared/test-fixtures/builder-ai-edit';
import { generateText, Output } from 'ai';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { builderAiProviderCooldown } from './builder-ai-provider-cooldown';
import { runBuilderAiProviderChain } from './run-builder-ai-provider-chain';

const ai = vi.hoisted(() => {
  class NoObject extends Error {
    static isInstance(error: unknown): boolean {
      return error instanceof NoObject;
    }
  }
  return { NoObject };
});

vi.mock('ai', () => ({
  generateText: vi.fn(),
  NoObjectGeneratedError: ai.NoObject,
  Output: { json: vi.fn(() => 'json-output') },
}));

const providers = [
  { model: { id: 'google' } as never, name: 'google:gemma-4-31b-it' },
  { model: { id: 'groq' } as never, name: 'groq:openai/gpt-oss-120b' },
];
const validPlan = {
  operations: [
    {
      componentId: 'hero-1',
      kind: 'update_component',
      patch: { componentType: 'Hero', title: 'Safer title' },
    },
  ],
  status: 'proposed',
  summary: 'Update the hero title',
};

describe('runBuilderAiProviderChain', () => {
  beforeEach(() => {
    builderAiProviderCooldown.resetForTests();
    vi.clearAllMocks();
  });

  it('accepts the previously attested Cerebras pair during the Google rollout', async () => {
    const transitionProviders = [
      {
        model: { id: 'cerebras' } as never,
        name: 'cerebras:gemma-4-31b',
      },
      providers[1] as (typeof providers)[number],
    ];
    vi.mocked(generateText).mockResolvedValueOnce({
      output: validPlan,
    } as never);

    await expect(
      runBuilderAiProviderChain({
        currentConfig: builderAiEditTestFixture.request.currentConfig,
        deadlineAt: Date.now() + 5_000,
        prompt: 'Update the hero',
        providerChain: transitionProviders,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual(validPlan);

    expect(generateText).toHaveBeenCalledOnce();
  });

  it('falls through malformed JSON and sends schema-free JSON transport', async () => {
    vi.mocked(generateText)
      .mockResolvedValueOnce({ output: '{not-json' } as never)
      .mockResolvedValueOnce({ output: validPlan } as never);

    await expect(
      runBuilderAiProviderChain({
        currentConfig: builderAiEditTestFixture.request.currentConfig,
        deadlineAt: Date.now() + 5_000,
        prompt: 'Update the hero',
        providerChain: providers,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual(validPlan);

    expect(generateText).toHaveBeenCalledTimes(2);
    for (const [request] of vi.mocked(generateText).mock.calls) {
      expect(request).toEqual(
        expect.objectContaining({
          maxOutputTokens: 6_144,
          maxRetries: 0,
          output: 'json-output',
        })
      );
      expect(request).not.toHaveProperty('schema');
    }
    expect(Output.json).toHaveBeenCalledTimes(2);
  });

  it('never starts a transport call when the response margin has elapsed', async () => {
    await expect(
      runBuilderAiProviderChain({
        currentConfig: builderAiEditTestFixture.request.currentConfig,
        deadlineAt: Date.now() + 500,
        prompt: 'Update the hero',
        providerChain: providers,
        signal: new AbortController().signal,
      })
    ).rejects.toEqual({ code: 'ai_provider_unavailable' });
    expect(generateText).not.toHaveBeenCalled();
  });

  it('returns invalid-output only after each provider emits an invalid plan', async () => {
    vi.mocked(generateText).mockResolvedValue({
      output: { operations: [], status: 'proposed', summary: '' },
    } as never);

    await expect(
      runBuilderAiProviderChain({
        currentConfig: builderAiEditTestFixture.request.currentConfig,
        deadlineAt: Date.now() + 5_000,
        prompt: 'Update the hero',
        providerChain: providers,
        signal: new AbortController().signal,
      })
    ).rejects.toEqual({ code: 'ai_builder_invalid_output' });

    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it('falls through reliable-provider quota failures before accepting the next provider', async () => {
    vi.mocked(generateText)
      .mockRejectedValueOnce(new Error('quota exceeded'))
      .mockResolvedValueOnce({ output: validPlan } as never);

    await expect(
      runBuilderAiProviderChain({
        currentConfig: builderAiEditTestFixture.request.currentConfig,
        deadlineAt: Date.now() + 5_000,
        prompt: 'Update the hero',
        providerChain: providers,
        signal: new AbortController().signal,
      })
    ).resolves.toEqual(validPlan);

    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it('reports quota exhaustion when every provider fails for capacity', async () => {
    vi.mocked(generateText).mockRejectedValue(new Error('429 rate limit'));

    await expect(
      runBuilderAiProviderChain({
        currentConfig: builderAiEditTestFixture.request.currentConfig,
        deadlineAt: Date.now() + 5_000,
        prompt: 'Update the hero',
        providerChain: providers,
        signal: new AbortController().signal,
      })
    ).rejects.toEqual({ code: 'ai_provider_rate_limited' });

    expect(generateText).toHaveBeenCalledTimes(2);
  });

  it('skips cooling reliable providers when an opportunistic fallback is available', async () => {
    const fallback = {
      model: { id: 'openrouter' } as never,
      name: 'openrouter:google/gemma-4-31b-it:free',
      opportunistic: true,
    };
    vi.mocked(generateText).mockResolvedValue({ output: validPlan } as never);

    await expect(
      runBuilderAiProviderChain({
        cooldown: { isCoolingDown: (name) => name !== fallback.name },
        currentConfig: builderAiEditTestFixture.request.currentConfig,
        deadlineAt: Date.now() + 5_000,
        prompt: 'Update the hero',
        providerChain: [...providers, fallback],
        signal: new AbortController().signal,
      })
    ).resolves.toEqual(validPlan);

    expect(generateText).toHaveBeenCalledOnce();
    expect(vi.mocked(generateText).mock.calls[0]?.[0].model).toBe(
      fallback.model
    );
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
});

describe('getTextProviderChain', () => {
  it('keeps the platform-wide chain unchanged when OPENAI_API_KEY is configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('CEREBRAS_API_KEY', 'csk-test');
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    vi.stubEnv('OPENROUTER_API_KEY', '');

    const { getTextProviderChain } = await import('./text-provider-chain');

    expect(getTextProviderChain().map((provider) => provider.name)).toEqual([
      'cerebras:gemma-4-31b',
      'groq:openai/gpt-oss-120b',
      'google:gemini-2.5-flash',
      'google:gemini-2.5-flash-lite',
    ]);
  });

  it('places OpenAI first in getOnboardingTextProviderChain when OPENAI_API_KEY is configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('CEREBRAS_API_KEY', 'csk-test');
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    vi.stubEnv('OPENROUTER_API_KEY', '');

    const { getOnboardingTextProviderChain } = await import(
      './text-provider-chain'
    );
    const chain = getOnboardingTextProviderChain();

    expect(chain.map((provider) => provider.name)).toEqual([
      'openai:gpt-5-mini',
      'cerebras:gemma-4-31b',
      'groq:openai/gpt-oss-120b',
      'google:gemini-2.5-flash',
      'google:gemini-2.5-flash-lite',
    ]);
    expect(chain[0].vision).toBe(true);
  });

  it('honors OPENAI_TEXT_MODEL to override the onboarding OpenAI model name', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    vi.stubEnv('OPENAI_TEXT_MODEL', 'gpt-4o-mini');
    vi.stubEnv('CEREBRAS_API_KEY', '');
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('OPENROUTER_API_KEY', '');

    const { getOnboardingTextProviderChain } = await import(
      './text-provider-chain'
    );

    expect(getOnboardingTextProviderChain()[0].name).toBe('openai:gpt-4o-mini');
  });

  it('orders Cerebras → Groq → Gemini → Gemini-Lite → OpenRouter when all provider keys are set', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('CEREBRAS_API_KEY', 'csk-test');
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');

    const { getTextProviderChain } = await import('./text-provider-chain');
    const names = getTextProviderChain().map((p) => p.name);

    expect(names).toEqual([
      'cerebras:gemma-4-31b',
      'groq:openai/gpt-oss-120b',
      'google:gemini-2.5-flash',
      'google:gemini-2.5-flash-lite',
      'openrouter:google/gemma-4-31b-it:free',
    ]);
  });

  it('degrades to the Gemini-only chain when no provider keys are configured', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('CEREBRAS_API_KEY', '');
    vi.stubEnv('GROQ_API_KEY', '');
    vi.stubEnv('OPENROUTER_API_KEY', '');

    const { getTextProviderChain } = await import('./text-provider-chain');
    const names = getTextProviderChain().map((p) => p.name);

    expect(names).toEqual([
      'google:gemini-2.5-flash',
      'google:gemini-2.5-flash-lite',
    ]);
  });

  it('honors COPILOT_CEREBRAS_MODEL to swap the preview model without a code change', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('CEREBRAS_API_KEY', 'csk-test');
    vi.stubEnv('COPILOT_CEREBRAS_MODEL', 'gemma-4-production');

    const { getTextProviderChain } = await import('./text-provider-chain');

    expect(getTextProviderChain()[0].name).toBe('cerebras:gemma-4-production');
  });

  it('marks vision-capable providers and leaves Groq text-only', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('CEREBRAS_API_KEY', 'csk-test');
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    vi.stubEnv('OPENROUTER_API_KEY', '');

    const { getTextProviderChain } = await import('./text-provider-chain');
    const visionByName = Object.fromEntries(
      getTextProviderChain().map((p) => [p.name, Boolean(p.vision)])
    );

    expect(visionByName).toEqual({
      'cerebras:gemma-4-31b': true,
      'groq:openai/gpt-oss-120b': false,
      'google:gemini-2.5-flash': true,
      'google:gemini-2.5-flash-lite': true,
    });
  });

  it('flags only OpenRouter as opportunistic', async () => {
    vi.stubEnv('CEREBRAS_API_KEY', 'csk-test');
    vi.stubEnv('GROQ_API_KEY', 'gsk-test');
    vi.stubEnv('OPENROUTER_API_KEY', 'sk-or-test');

    const { getTextProviderChain } = await import('./text-provider-chain');
    const opportunistic = getTextProviderChain()
      .filter((p) => p.opportunistic)
      .map((p) => p.name);

    expect(opportunistic).toEqual(['openrouter:google/gemma-4-31b-it:free']);
  });
});

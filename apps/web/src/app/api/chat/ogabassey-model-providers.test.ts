import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getOgabasseyPreferredProviders,
  OGABASSEY_MODEL_PROVIDER_OPTIONS,
  resolveChainPerProviderTimeoutMs,
} from './ogabassey-model-providers';

describe('ogabassey-model-providers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('orders OpenAI, Meta (META_MODEL_API_KEY only), and optional DeepSeek providers', () => {
    vi.stubEnv('OPENAI_API_KEY', 'openai-key');
    vi.stubEnv('META_MODEL_API_KEY', 'meta-key');
    vi.stubEnv('MODEL_API_KEY', 'generic-key-ignored');
    vi.stubEnv('DEEPSEEK_API_KEY', 'deepseek-key');

    expect(
      getOgabasseyPreferredProviders({ includeDeepSeek: false }).map(
        (p) => p.name
      )
    ).toEqual(['openai:gpt-6-luna', 'meta:muse-ember-1.0']);

    expect(
      getOgabasseyPreferredProviders({ includeDeepSeek: true }).map(
        (p) => p.name
      )
    ).toEqual([
      'openai:gpt-6-luna',
      'meta:muse-ember-1.0',
      'deepseek:deepseek-flash',
    ]);
  });

  it('ignores unscoped MODEL_API_KEY when META_MODEL_API_KEY is absent', () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    vi.stubEnv('META_MODEL_API_KEY', '');
    vi.stubEnv('DEEPSEEK_API_KEY', '');
    vi.stubEnv('MODEL_API_KEY', 'unrelated-key');

    expect(getOgabasseyPreferredProviders({ includeDeepSeek: true })).toEqual(
      []
    );
  });

  it('sets minimal Meta reasoning effort and divides timeout across providers', () => {
    expect(OGABASSEY_MODEL_PROVIDER_OPTIONS.meta).toEqual({
      reasoningEffort: 'minimal',
    });
    expect(resolveChainPerProviderTimeoutMs(12_000, 2)).toBe(6_000);
    expect(resolveChainPerProviderTimeoutMs(12_000, 3)).toBe(4_000);
    expect(resolveChainPerProviderTimeoutMs(0, 3)).toBe(0);
  });
});

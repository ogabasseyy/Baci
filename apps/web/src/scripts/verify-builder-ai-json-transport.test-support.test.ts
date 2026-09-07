import { describe, expect, it } from 'vitest';
import {
  createDependencies,
  loadSmokeModule,
  REFUSAL_RECORD,
} from './verify-builder-ai-json-transport.test-support';

describe('verifyBuilderAiJsonTransport test support', () => {
  it('builds default smoke dependencies with approved env sources', async () => {
    const dependencies = createDependencies();

    expect(dependencies.environment).toMatchObject({
      BACI_APPROVE_PAID_AI_SMOKE: '1',
      BACI_WEB_ENV_SOURCE: '/primary/apps/web/.env',
      GOOGLE_GENAI_API_KEY: 'google-test',
      GROQ_API_KEY: 'groq-test',
      OPENROUTER_API_KEY: 'openrouter-test',
    });
    await expect(
      dependencies.validateEnvironmentSource('/primary/apps/web/.env.local')
    ).resolves.toEqual({ path: '/primary/apps/web/.env.local' });
    await expect(
      dependencies.validateEnvironmentSource('/outside/.env')
    ).resolves.toBeNull();
    await expect(dependencies.materializeProviders(new AbortController().signal))
      .resolves.toEqual([
        { model: { id: 'google' }, name: 'google:gemma-4-31b-it' },
        { model: { id: 'groq' }, name: 'groq:openai/gpt-oss-120b' },
        {
          model: { id: 'openrouter' },
          name: 'openrouter:google/gemma-4-31b-it:free',
          opportunistic: true,
        },
      ]);
  });

  it('merges caller overrides into the default environment', () => {
    const dependencies = createDependencies({
      BACI_APPROVE_PAID_AI_SMOKE: '0',
      OPENROUTER_API_KEY: undefined,
    });

    expect(dependencies.environment.BACI_APPROVE_PAID_AI_SMOKE).toBe('0');
    expect(dependencies.environment.OPENROUTER_API_KEY).toBeUndefined();
    expect(dependencies.environment.GOOGLE_GENAI_API_KEY).toBe('google-test');
  });

  it('loads the smoke module and pins the refusal record contract', async () => {
    const module = await loadSmokeModule();

    expect(module.verifyBuilderAiJsonTransport).toBeTypeOf('function');
    expect(REFUSAL_RECORD).toBe(
      'provider=none model=none result=refused latencyMs=0'
    );
  });
});

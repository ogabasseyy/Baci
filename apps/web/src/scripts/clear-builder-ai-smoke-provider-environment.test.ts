import { describe, expect, it } from 'vitest';
import { clearBuilderAiSmokeProviderEnvironment } from './clear-builder-ai-smoke-provider-environment';

describe('clearBuilderAiSmokeProviderEnvironment', () => {
  it('removes inherited provider credentials and attestations without clearing unrelated environment', () => {
    const environment: NodeJS.ProcessEnv = {
      CEREBRAS_API_KEY: 'legacy-test-key',
      GOOGLE_GENAI_API_KEY: 'test-key',
      GROQ_BUILDER_ACCOUNT_REF: 'test-account',
      KEEP_ME: 'safe',
      OPENROUTER_API_KEY: 'test-openrouter-key',
    };

    clearBuilderAiSmokeProviderEnvironment(environment);

    expect(environment).toEqual({ KEEP_ME: 'safe' });
  });
});

import { describe, expect, it } from 'vitest';
import { builderAiProviderModelFactories } from './builder-ai-provider-model-factories';

describe('builder AI provider model factories', () => {
  it('exports lazy factories rather than a constructed provider catalog', () => {
    expect(typeof builderAiProviderModelFactories.createGoogleModel).toBe(
      'function'
    );
    expect(typeof builderAiProviderModelFactories.createGroqModel).toBe(
      'function'
    );
    expect(typeof builderAiProviderModelFactories.createOpenRouterModel).toBe(
      'function'
    );
  });

  it('binds the primary factory to Google-hosted Gemma 4 31B', () => {
    const model = builderAiProviderModelFactories.createGoogleModel('key');

    expect(model).toMatchObject({
      modelId: 'gemma-4-31b-it',
      provider: 'google.generative-ai',
    });
  });
});

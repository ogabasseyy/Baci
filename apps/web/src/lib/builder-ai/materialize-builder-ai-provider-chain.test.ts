import { describe, expect, it } from 'vitest';
import { materializeBuilderAiProviderChain } from './materialize-builder-ai-provider-chain';

describe('materializeBuilderAiProviderChain', () => {
  it('returns a typed no-provider result rather than an unattested fallback', () => {
    expect(
      materializeBuilderAiProviderChain(
        {},
        {
          createCerebrasModel: () => ({}) as never,
          createGoogleModel: () => ({}) as never,
          createGroqModel: () => ({}) as never,
          createOpenRouterModel: () => ({}) as never,
        }
      )
    ).toEqual({ code: 'ai_provider_unavailable', providers: [] });
  });
});

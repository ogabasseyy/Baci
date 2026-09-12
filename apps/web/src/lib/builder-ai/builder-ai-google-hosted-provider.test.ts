import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  type BuilderAiProviderEnvironment,
  type BuilderAiProviderFactories,
  materializeBuilderAiProviders,
} from './builder-ai-provider-catalog';
import { createBuilderAiBootstrapAttestation } from './create-builder-ai-bootstrap-attestation';

const now = Date.parse('2026-08-05T00:00:00.000Z');
const releaseAttestedAt = '2026-08-01T00:00:00.000Z';
const pepper = 'p'.repeat(32);

function bindingTag(
  provider: string,
  credential: string,
  accountRef: string,
  approvedModel: string
): string {
  return createHmac('sha256', pepper)
    .update(
      JSON.stringify([
        'baci-builder-ai-provider-binding',
        'v1',
        provider,
        credential,
        accountRef,
        'approved-reliable',
        approvedModel,
        releaseAttestedAt,
      ])
    )
    .digest('hex');
}

describe('Builder AI Google-hosted Gemma regression', () => {
  it('materializes Google Gemma 4 31B before the Groq fallback without Cerebras', () => {
    const createGoogleModel = vi.fn(
      (key: string) => ({ key, provider: 'google' }) as never
    );
    const factories = {
      createCerebrasModel: vi.fn(),
      createGoogleModel,
      createGroqModel: vi.fn(
        (key: string) => ({ key, provider: 'groq' }) as never
      ),
      createOpenRouterModel: vi.fn(),
    } satisfies BuilderAiProviderFactories;
    const environment = {
      BUILDER_AI_PROVIDER_BINDING_PEPPER: pepper,
      GOOGLE_BUILDER_ACCOUNT_REF: 'google-account',
      GOOGLE_BUILDER_APPROVED_MODEL: 'gemma-4-31b-it',
      GOOGLE_BUILDER_CREDENTIAL_BINDING_TAG: bindingTag(
        'google',
        'google-key',
        'google-account',
        'gemma-4-31b-it'
      ),
      GOOGLE_BUILDER_DEPLOYMENT_TIER: 'approved-reliable',
      GOOGLE_BUILDER_RELEASE_ATTESTED_AT: releaseAttestedAt,
      GOOGLE_GENAI_API_KEY: 'google-key',
      GROQ_API_KEY: 'groq-key',
      GROQ_BUILDER_ACCOUNT_REF: 'groq-account',
      GROQ_BUILDER_APPROVED_MODEL: 'openai/gpt-oss-120b',
      GROQ_BUILDER_CREDENTIAL_BINDING_TAG: bindingTag(
        'groq',
        'groq-key',
        'groq-account',
        'openai/gpt-oss-120b'
      ),
      GROQ_BUILDER_DEPLOYMENT_TIER: 'approved-reliable',
      GROQ_BUILDER_RELEASE_ATTESTED_AT: releaseAttestedAt,
    } satisfies BuilderAiProviderEnvironment;

    expect(
      materializeBuilderAiProviders(environment, factories, { now }).map(
        ({ name }) => name
      )
    ).toEqual(['google:gemma-4-31b-it', 'groq:openai/gpt-oss-120b']);
    expect(createGoogleModel).toHaveBeenCalledWith('google-key');
  });

  it('creates the bootstrap attestation from Google and Groq credentials', () => {
    const attestation = createBuilderAiBootstrapAttestation(
      {
        GOOGLE_GENAI_API_KEY: 'google-key',
        GROQ_API_KEY: 'groq-key',
      },
      new Date(releaseAttestedAt)
    );

    expect(attestation?.values).toMatchObject({
      GOOGLE_BUILDER_ACCOUNT_REF: 'deployment:baci-production:google',
      GOOGLE_BUILDER_APPROVED_MODEL: 'gemma-4-31b-it',
      GROQ_BUILDER_ACCOUNT_REF: 'deployment:baci-production:groq',
    });
  });
});

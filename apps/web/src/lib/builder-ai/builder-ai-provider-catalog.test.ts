import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  type BuilderAiProviderEnvironment,
  type BuilderAiProviderFactories,
  materializeBuilderAiProviders,
} from './builder-ai-provider-catalog';

const factories: BuilderAiProviderFactories = {
  createCerebrasModel: vi.fn((key) => ({ provider: 'cerebras', key }) as never),
  createGoogleModel: vi.fn((key) => ({ provider: 'google', key }) as never),
  createGroqModel: vi.fn((key) => ({ provider: 'groq', key }) as never),
  createOpenRouterModel: vi.fn(
    (key) => ({ provider: 'openrouter', key }) as never
  ),
};

function bindingTag(
  provider: string,
  environment: {
    accountRef: string;
    approvedModel: string;
    credential: string;
    deploymentTier: string;
    releaseAttestedAt: string;
  },
  pepper: string
): string {
  return createHmac('sha256', pepper)
    .update(
      JSON.stringify([
        'baci-builder-ai-provider-binding',
        'v1',
        provider,
        environment.credential,
        environment.accountRef,
        environment.deploymentTier,
        environment.approvedModel,
        environment.releaseAttestedAt,
      ])
    )
    .digest('hex');
}

describe('builder AI provider catalog', () => {
  const bindingPepper = 'p'.repeat(32);
  const googleAttestation = {
    accountRef: 'google-account',
    approvedModel: 'gemma-4-31b-it',
    credential: 'google-key',
    deploymentTier: 'approved-reliable',
    releaseAttestedAt: '2026-08-01T00:00:00.000Z',
  };
  const cerebrasAttestation = {
    accountRef: 'cerebras-account',
    approvedModel: 'gemma-4-31b',
    credential: 'cerebras-key',
    deploymentTier: 'approved-reliable',
    releaseAttestedAt: '2026-08-01T00:00:00.000Z',
  };
  const groqAttestation = {
    accountRef: 'groq-account',
    approvedModel: 'openai/gpt-oss-120b',
    credential: 'groq-key',
    deploymentTier: 'approved-reliable',
    releaseAttestedAt: '2026-08-01T00:00:00.000Z',
  };
  const attestedEnvironment = {
    GOOGLE_GENAI_API_KEY: googleAttestation.credential,
    GOOGLE_BUILDER_ACCOUNT_REF: googleAttestation.accountRef,
    GOOGLE_BUILDER_CREDENTIAL_BINDING_TAG: bindingTag(
      'google',
      googleAttestation,
      bindingPepper
    ),
    GOOGLE_BUILDER_APPROVED_MODEL: googleAttestation.approvedModel,
    GOOGLE_BUILDER_DEPLOYMENT_TIER: googleAttestation.deploymentTier,
    GOOGLE_BUILDER_RELEASE_ATTESTED_AT: googleAttestation.releaseAttestedAt,
    GROQ_API_KEY: groqAttestation.credential,
    GROQ_BUILDER_ACCOUNT_REF: groqAttestation.accountRef,
    GROQ_BUILDER_CREDENTIAL_BINDING_TAG: bindingTag(
      'groq',
      groqAttestation,
      bindingPepper
    ),
    GROQ_BUILDER_APPROVED_MODEL: groqAttestation.approvedModel,
    GROQ_BUILDER_DEPLOYMENT_TIER: groqAttestation.deploymentTier,
    GROQ_BUILDER_RELEASE_ATTESTED_AT: groqAttestation.releaseAttestedAt,
    BUILDER_AI_PROVIDER_BINDING_PEPPER: bindingPepper,
  };

  it('keeps the previously attested Cerebras pair available during the Google rollout', () => {
    const legacyEnvironment = {
      CEREBRAS_API_KEY: cerebrasAttestation.credential,
      CEREBRAS_BUILDER_ACCOUNT_REF: cerebrasAttestation.accountRef,
      CEREBRAS_BUILDER_CREDENTIAL_BINDING_TAG: bindingTag(
        'cerebras',
        cerebrasAttestation,
        bindingPepper
      ),
      CEREBRAS_BUILDER_APPROVED_MODEL: cerebrasAttestation.approvedModel,
      CEREBRAS_BUILDER_DEPLOYMENT_TIER: cerebrasAttestation.deploymentTier,
      CEREBRAS_BUILDER_RELEASE_ATTESTED_AT:
        cerebrasAttestation.releaseAttestedAt,
      GROQ_API_KEY: groqAttestation.credential,
      GROQ_BUILDER_ACCOUNT_REF: groqAttestation.accountRef,
      GROQ_BUILDER_CREDENTIAL_BINDING_TAG: bindingTag(
        'groq',
        groqAttestation,
        bindingPepper
      ),
      GROQ_BUILDER_APPROVED_MODEL: groqAttestation.approvedModel,
      GROQ_BUILDER_DEPLOYMENT_TIER: groqAttestation.deploymentTier,
      GROQ_BUILDER_RELEASE_ATTESTED_AT: groqAttestation.releaseAttestedAt,
      BUILDER_AI_PROVIDER_BINDING_PEPPER: bindingPepper,
    } satisfies BuilderAiProviderEnvironment;
    const transitionFactories = {
      ...factories,
      createCerebrasModel: vi.fn(
        (key: string) => ({ provider: 'cerebras', key }) as never
      ),
    } satisfies BuilderAiProviderFactories;

    expect(
      materializeBuilderAiProviders(legacyEnvironment, transitionFactories, {
        now: Date.parse('2026-08-05T00:00:00.000Z'),
      }).map(({ name }) => name)
    ).toEqual(['cerebras:gemma-4-31b', 'groq:openai/gpt-oss-120b']);
  });

  it('fails closed without both credential-bound reliable-provider attestations', () => {
    expect(
      materializeBuilderAiProviders(
        { GOOGLE_GENAI_API_KEY: 'google-key' },
        factories,
        { now: Date.parse('2026-08-05T00:00:00.000Z') }
      )
    ).toEqual([]);
    expect(factories.createGoogleModel).not.toHaveBeenCalled();
  });

  it('fails closed when a keyed credential-binding tag does not bind to the deployed key', () => {
    expect(
      materializeBuilderAiProviders(
        {
          ...attestedEnvironment,
          GROQ_BUILDER_CREDENTIAL_BINDING_TAG: '0'.repeat(64),
        },
        factories,
        { now: Date.parse('2026-08-05T00:00:00.000Z') }
      )
    ).toEqual([]);
  });

  it('invalidates the canonical credential binding when any attested field changes', () => {
    const now = Date.parse('2026-08-05T00:00:00.000Z');
    for (const environment of [
      { ...attestedEnvironment, GOOGLE_GENAI_API_KEY: 'wrong-google-key' },
      {
        ...attestedEnvironment,
        GOOGLE_BUILDER_ACCOUNT_REF: 'another-account',
      },
      {
        ...attestedEnvironment,
        GOOGLE_BUILDER_DEPLOYMENT_TIER: 'another-tier',
      },
      { ...attestedEnvironment, GOOGLE_BUILDER_APPROVED_MODEL: 'other' },
      {
        ...attestedEnvironment,
        GOOGLE_BUILDER_RELEASE_ATTESTED_AT: '2026-08-02T00:00:00.000Z',
      },
      {
        ...attestedEnvironment,
        BUILDER_AI_PROVIDER_BINDING_PEPPER: 'wrong-pepper',
      },
      {
        ...attestedEnvironment,
        GROQ_BUILDER_CREDENTIAL_BINDING_TAG:
          attestedEnvironment.GOOGLE_BUILDER_CREDENTIAL_BINDING_TAG,
      },
      {
        ...attestedEnvironment,
        GOOGLE_BUILDER_CREDENTIAL_BINDING_TAG: 'bad-tag',
      },
    ]) {
      expect(
        materializeBuilderAiProviders(environment, factories, { now })
      ).toEqual([]);
    }
  });

  it('fails closed when a release record omits its binding pepper or provider tag', () => {
    const now = Date.parse('2026-08-05T00:00:00.000Z');
    expect(
      materializeBuilderAiProviders(
        { ...attestedEnvironment, BUILDER_AI_PROVIDER_BINDING_PEPPER: '' },
        factories,
        { now }
      )
    ).toEqual([]);
    expect(
      materializeBuilderAiProviders(
        { ...attestedEnvironment, BUILDER_AI_PROVIDER_BINDING_PEPPER: 'weak' },
        factories,
        { now }
      )
    ).toEqual([]);
    expect(
      materializeBuilderAiProviders(
        { ...attestedEnvironment, GROQ_BUILDER_CREDENTIAL_BINDING_TAG: '' },
        factories,
        { now }
      )
    ).toEqual([]);
  });

  it('fails closed for an expired release attestation or a model mismatch', () => {
    const now = Date.parse('2026-08-05T00:00:00.000Z');
    expect(
      materializeBuilderAiProviders(
        {
          ...attestedEnvironment,
          GOOGLE_BUILDER_RELEASE_ATTESTED_AT: '2026-01-01T00:00:00.000Z',
        },
        factories,
        { now }
      )
    ).toEqual([]);
    expect(
      materializeBuilderAiProviders(
        { ...attestedEnvironment, GROQ_BUILDER_APPROVED_MODEL: 'wrong-model' },
        factories,
        { now }
      )
    ).toEqual([]);
  });

  it('materializes the approved reliable pair and gates OpenRouter on exact runtime approval', () => {
    expect(
      materializeBuilderAiProviders(
        {
          ...attestedEnvironment,
          OPENROUTER_API_KEY: 'openrouter-key',
        },
        factories,
        { now: Date.parse('2026-08-05T00:00:00.000Z') }
      ).map(({ name }) => name)
    ).toEqual(['google:gemma-4-31b-it', 'groq:openai/gpt-oss-120b']);

    expect(
      materializeBuilderAiProviders(
        {
          ...attestedEnvironment,
          OPENROUTER_API_KEY: 'openrouter-key',
          OPENROUTER_BUILDER_TRANSPORT_APPROVED_AT: '2026-08-01T00:00:00.000Z',
          OPENROUTER_BUILDER_TRANSPORT_APPROVED_MODEL:
            'google/gemma-4-31b-it:free',
        },
        factories,
        { now: Date.parse('2026-08-05T00:00:00.000Z') }
      ).map(({ name }) => name)
    ).toEqual([
      'google:gemma-4-31b-it',
      'groq:openai/gpt-oss-120b',
      'openrouter:google/gemma-4-31b-it:free',
    ]);
  });

  it('allows the pinned optional transport only for an explicitly approved smoke run', () => {
    expect(
      materializeBuilderAiProviders(
        {
          ...attestedEnvironment,
          OPENROUTER_API_KEY: 'openrouter-key',
        },
        factories,
        {
          now: Date.parse('2026-08-05T00:00:00.000Z'),
          purpose: 'smoke',
        }
      ).map(({ name }) => name)
    ).toEqual([
      'google:gemma-4-31b-it',
      'groq:openai/gpt-oss-120b',
      'openrouter:google/gemma-4-31b-it:free',
    ]);
  });

  it('returns an empty catalog when no provider credentials are configured', () => {
    expect(materializeBuilderAiProviders({}, factories)).toEqual([]);
  });
});

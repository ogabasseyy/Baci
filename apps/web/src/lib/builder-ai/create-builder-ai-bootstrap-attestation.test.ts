import { describe, expect, it } from 'vitest';
import { createBuilderAiBootstrapAttestation } from './create-builder-ai-bootstrap-attestation';
import { createBuilderAiProviderBindingTag } from './create-builder-ai-provider-binding-tag';

const environment = {
  GOOGLE_GENAI_API_KEY: 'google-key',
  GROQ_API_KEY: 'groq-key',
};
const now = new Date('2026-08-05T12:00:00.000Z');

describe('createBuilderAiBootstrapAttestation', () => {
  it('creates new, correctly bound deployment attestation values in memory', () => {
    const attestation = createBuilderAiBootstrapAttestation(environment, now);

    expect(attestation?.values).toMatchObject({
      GOOGLE_BUILDER_ACCOUNT_REF: 'deployment:baci-production:google',
      GOOGLE_BUILDER_DEPLOYMENT_TIER: 'provider-tier-unverified',
      GOOGLE_BUILDER_RELEASE_ATTESTED_AT: now.toISOString(),
      GROQ_BUILDER_ACCOUNT_REF: 'deployment:baci-production:groq',
      GROQ_BUILDER_DEPLOYMENT_TIER: 'provider-tier-unverified',
      GROQ_BUILDER_RELEASE_ATTESTED_AT: now.toISOString(),
    });
    expect(
      Buffer.byteLength(
        attestation?.values.BUILDER_AI_PROVIDER_BINDING_PEPPER ?? '',
        'utf8'
      )
    ).toBeGreaterThanOrEqual(32);
    expect(attestation?.environment.GOOGLE_BUILDER_CREDENTIAL_BINDING_TAG).toBe(
      createBuilderAiProviderBindingTag(
        {
          accountRef: 'deployment:baci-production:google',
          approvedModel:
            attestation?.values.GOOGLE_BUILDER_APPROVED_MODEL ?? '',
          deploymentTier: 'provider-tier-unverified',
          key: environment.GOOGLE_GENAI_API_KEY,
          providerName: 'google',
          releaseAttestedAt: now.toISOString(),
        },
        attestation?.values.BUILDER_AI_PROVIDER_BINDING_PEPPER ?? ''
      )
    );
    expect(attestation?.environment.GROQ_BUILDER_CREDENTIAL_BINDING_TAG).toBe(
      createBuilderAiProviderBindingTag(
        {
          accountRef: 'deployment:baci-production:groq',
          approvedModel: attestation?.values.GROQ_BUILDER_APPROVED_MODEL ?? '',
          deploymentTier: 'provider-tier-unverified',
          key: environment.GROQ_API_KEY,
          providerName: 'groq',
          releaseAttestedAt: now.toISOString(),
        },
        attestation?.values.BUILDER_AI_PROVIDER_BINDING_PEPPER ?? ''
      )
    );
  });

  it('does not construct a payload without both reliable provider credentials', () => {
    expect(
      createBuilderAiBootstrapAttestation(
        { GOOGLE_GENAI_API_KEY: 'google-key' },
        now
      )
    ).toBeNull();
  });

  it('trims credentials and creates a new pepper for each attestation', () => {
    const first = createBuilderAiBootstrapAttestation(
      { GOOGLE_GENAI_API_KEY: ' google-key ', GROQ_API_KEY: ' groq-key ' },
      now
    );
    const second = createBuilderAiBootstrapAttestation(environment, now);

    expect(first?.environment.GOOGLE_GENAI_API_KEY).toBe('google-key');
    expect(first?.environment.GROQ_API_KEY).toBe('groq-key');
    expect(first?.values.BUILDER_AI_PROVIDER_BINDING_PEPPER).not.toBe(
      second?.values.BUILDER_AI_PROVIDER_BINDING_PEPPER
    );
  });

  it.each([
    [{ GOOGLE_GENAI_API_KEY: ' ', GROQ_API_KEY: 'groq-key' }],
    [{ GOOGLE_GENAI_API_KEY: 'google-key', GROQ_API_KEY: ' ' }],
  ])('rejects blank reliable-provider credentials', (missingCredential) => {
    expect(
      createBuilderAiBootstrapAttestation(missingCredential, now)
    ).toBeNull();
  });
});

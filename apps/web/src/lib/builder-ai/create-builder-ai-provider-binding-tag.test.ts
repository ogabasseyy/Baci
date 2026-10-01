import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createBuilderAiProviderBindingTag } from './create-builder-ai-provider-binding-tag';

const pepper = 'p'.repeat(32);
const input = {
  accountRef: 'deployment:baci-production:cerebras',
  approvedModel: 'gemma-4-31b',
  deploymentTier: 'provider-tier-unverified',
  key: 'provider-secret',
  providerName: 'cerebras',
  releaseAttestedAt: '2026-08-05T12:00:00.000Z',
};

describe('createBuilderAiProviderBindingTag', () => {
  it('preserves the catalog’s domain-separated canonical payload', () => {
    const expected = createHmac('sha256', pepper)
      .update(
        JSON.stringify([
          'baci-builder-ai-provider-binding',
          'v1',
          'cerebras',
          'provider-secret',
          'deployment:baci-production:cerebras',
          'provider-tier-unverified',
          'gemma-4-31b',
          '2026-08-05T12:00:00.000Z',
        ])
      )
      .digest('hex');

    expect(createBuilderAiProviderBindingTag(input, pepper)).toBe(expected);
  });

  it.each([
    ['key', 'different-secret'],
    ['accountRef', 'deployment:other:cerebras'],
    ['deploymentTier', 'provider-tier-verified'],
    ['approvedModel', 'other-model'],
    ['releaseAttestedAt', '2026-08-06T12:00:00.000Z'],
    ['providerName', 'groq'],
  ])('changes the tag when %s changes', (field, value) => {
    expect(
      createBuilderAiProviderBindingTag({ ...input, [field]: value }, pepper)
    ).not.toBe(createBuilderAiProviderBindingTag(input, pepper));
  });

  it('accepts exactly thirty-two bytes of pepper and rejects a thirty-one-byte pepper', () => {
    expect(createBuilderAiProviderBindingTag(input, 'p'.repeat(32))).toMatch(
      /^[a-f0-9]{64}$/
    );
    expect(createBuilderAiProviderBindingTag(input, 'p'.repeat(31))).toBeNull();
  });

  it.each([
    ['accountRef', ''],
    ['approvedModel', ''],
    ['deploymentTier', ''],
    ['key', ''],
    ['providerName', ''],
  ])('rejects an empty required %s field', (field, value) => {
    expect(
      createBuilderAiProviderBindingTag({ ...input, [field]: value }, pepper)
    ).toBeNull();
  });

  it('rejects an absent binding pepper', () => {
    expect(createBuilderAiProviderBindingTag(input, '')).toBeNull();
  });
});

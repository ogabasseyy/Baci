import { describe, expect, it } from 'vitest';
import { generationIdFor } from '../../../../../infra/cdn-transformer/pilot/generation-identity.mjs';
import { labGenerationIdFor } from './lab-generation-identity';

// The web runtime cannot import infra directly, so labGenerationIdFor
// mirrors the transformer original. This pins byte-identical digests:
// the JSON key order is load-bearing, and any drift silently unbinds
// every served generation.
describe('labGenerationIdFor parity', () => {
  const job = {
    assetId: 'logo-1',
    merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
    role: 'logo',
  };
  const encoderIdentity = {
    libvipsVersion: '8.18.6',
    name: 'sharp',
    sharpVersion: '0.35.4',
  };
  const input = {
    ...job,
    encoderIdentity,
    recipeId: 'pilot-r2-test',
    sourceSha256: 'd'.repeat(64),
  };

  it('matches the transformer digest exactly', () => {
    expect(labGenerationIdFor(input)).toBe(generationIdFor({ ...input, job }));
  });

  it('matches when the encoder object key order differs', () => {
    // Zod preserves schema order today, but the port must not depend on
    // it: rebuild the identity out of order and require the same id.
    const shuffled = {
      name: 'sharp',
      sharpVersion: '0.35.4',
      libvipsVersion: '8.18.6',
    };
    expect(labGenerationIdFor({ ...input, encoderIdentity: shuffled })).toBe(
      generationIdFor({ ...input, job })
    );
  });
});

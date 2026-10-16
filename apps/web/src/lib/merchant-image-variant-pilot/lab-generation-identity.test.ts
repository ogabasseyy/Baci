import { describe, expect, it } from 'vitest';
import { labGenerationIdFor } from './lab-generation-identity';

const BASE_INPUT = {
  assetId: 'logo-1',
  encoderIdentity: {
    libvipsVersion: '8.18.6',
    name: 'sharp',
    sharpVersion: '0.35.4',
  },
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  recipeId: 'pilot-r2-7d207bbbac68d8ba',
  role: 'logo',
  sourceSha256: 'a'.repeat(64),
};

describe('labGenerationIdFor', () => {
  it('computes a deterministic 64-char sha256 hex digest and changes on any input change', () => {
    const first = labGenerationIdFor(BASE_INPUT);
    const second = labGenerationIdFor({ ...BASE_INPUT });

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).toBe(second);

    expect(labGenerationIdFor({ ...BASE_INPUT, assetId: 'logo-2' })).not.toBe(
      first
    );
    expect(
      labGenerationIdFor({
        ...BASE_INPUT,
        encoderIdentity: {
          ...BASE_INPUT.encoderIdentity,
          sharpVersion: '0.35.5',
        },
      })
    ).not.toBe(first);
    expect(
      labGenerationIdFor({ ...BASE_INPUT, sourceSha256: 'b'.repeat(64) })
    ).not.toBe(first);
  });
});

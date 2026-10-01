import { describe, expect, it } from 'vitest';
import { builderDesignCapabilities } from './builder-design-capabilities';
import { builderPreviewResponseSchema } from './builder-preview-message';

describe('builder preview bridge responses', () => {
  it('accepts strict ready, rendered, and bounded error responses', () => {
    expect(
      builderPreviewResponseSchema.safeParse({
        capabilityHash: builderDesignCapabilities.capabilityHash,
        capabilityVersion: builderDesignCapabilities.capabilityVersion,
        type: 'baci.builder-preview.ready',
        version: 1,
      }).success
    ).toBe(true);
    expect(
      builderPreviewResponseSchema.safeParse({
        revision: 7,
        type: 'baci.builder-preview.rendered',
        version: 1,
      }).success
    ).toBe(true);
    expect(
      builderPreviewResponseSchema.safeParse({
        code: 'unsupported_capability',
        revision: 7,
        type: 'baci.builder-preview.error',
        version: 1,
      }).success
    ).toBe(true);
  });

  it('rejects unbounded error codes and unknown response fields', () => {
    expect(
      builderPreviewResponseSchema.safeParse({
        code: 'unsupported capability',
        type: 'baci.builder-preview.error',
        version: 1,
      }).success
    ).toBe(false);
    expect(
      builderPreviewResponseSchema.safeParse({
        revision: 7,
        type: 'baci.builder-preview.rendered',
        unexpected: true,
        version: 1,
      }).success
    ).toBe(false);
  });
});

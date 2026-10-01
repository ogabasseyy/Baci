import { builderDesignCapabilities } from '@baci/shared/contracts';
import { describe, expect, it } from 'vitest';
import { getBuilderDesignCapabilities } from './get-builder-design-capabilities';

describe('getBuilderDesignCapabilities', () => {
  it('returns the shared manifest and its deterministic capability hash', () => {
    const capabilities = getBuilderDesignCapabilities();

    expect(capabilities.manifest).toBe(builderDesignCapabilities);
    expect(capabilities.hash).toBe(builderDesignCapabilities.capabilityHash);
    expect(capabilities.manifest.components).toHaveLength(31);
  });
});

import { describe, expect, it } from 'vitest';
import {
  PIGGYVEST_STAGING_API_ORIGIN,
  piggyvestStagingConfigurationSchema,
} from './piggyvest-staging-configuration';

describe('piggyvestStagingConfigurationSchema', () => {
  it('fills only bounded staging defaults for explicit injected configuration', () => {
    expect(
      piggyvestStagingConfigurationSchema.parse({
        apiSecret: 'synthetic-secret',
        expectedBusinessId: 'business-synthetic',
      })
    ).toEqual({
      apiBaseUrl: PIGGYVEST_STAGING_API_ORIGIN,
      apiSecret: 'synthetic-secret',
      expectedBusinessId: 'business-synthetic',
      expectedCurrency: 'NGN',
      timeoutMs: 5_000,
      maxResponseBytes: 64 * 1024,
    });
  });

  it('rejects unbounded response settings', () => {
    expect(() =>
      piggyvestStagingConfigurationSchema.parse({
        apiSecret: 'synthetic-secret',
        expectedBusinessId: 'business-synthetic',
        expectedCurrency: 'NGN',
        maxResponseBytes: 64 * 1024 + 1,
      })
    ).toThrow();
  });
});

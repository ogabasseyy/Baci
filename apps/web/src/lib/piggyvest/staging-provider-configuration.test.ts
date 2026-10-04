import { describe, expect, it } from 'vitest';
import { piggyvestStagingConfigurationSchema } from '@/schemas/piggyvest-staging-configuration';
import { projectPiggyvestStagingProviderConfiguration } from './staging-provider-configuration';

describe('projectPiggyvestStagingProviderConfiguration', () => {
  it('projects only the six strict provider configuration fields', () => {
    const projection = projectPiggyvestStagingProviderConfiguration({
      apiBaseUrl: 'https://staging.piggyvest.business',
      apiSecret: 'synthetic-secret',
      expectedBusinessId: 'synthetic-business',
      expectedCurrency: 'NGN',
      timeoutMs: 5000,
      maxResponseBytes: 65536,
    });

    expect(Object.keys(projection)).toEqual([
      'apiBaseUrl',
      'apiSecret',
      'expectedBusinessId',
      'expectedCurrency',
      'timeoutMs',
      'maxResponseBytes',
    ]);
    expect(
      piggyvestStagingConfigurationSchema.safeParse(projection).success
    ).toBe(true);
  });
});

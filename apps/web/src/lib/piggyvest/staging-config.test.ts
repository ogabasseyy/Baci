import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  createPiggyvestStagingConfiguration,
  PIGGYVEST_STAGING_API_ORIGIN,
} from './staging-config';

describe('createPiggyvestStagingConfiguration', () => {
  const configuration = {
    apiSecret: 'synthetic-staging-secret',
    expectedBusinessId: 'business-synthetic',
  };

  it('uses the fixed staging origin with explicitly injected credentials', () => {
    expect(createPiggyvestStagingConfiguration(configuration)).toMatchObject({
      apiBaseUrl: PIGGYVEST_STAGING_API_ORIGIN,
      expectedBusinessId: 'business-synthetic',
    });
  });

  it.each([
    'https://piggyvest.business',
    'https://staging.piggyvest.business.evil.example',
    'http://staging.piggyvest.business',
  ])('rejects a non-staging provider origin (%s)', (apiBaseUrl) => {
    expect(() =>
      createPiggyvestStagingConfiguration({ ...configuration, apiBaseUrl })
    ).toThrow();
  });
});

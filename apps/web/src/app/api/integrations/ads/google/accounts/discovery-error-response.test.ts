import { describe, expect, it } from 'vitest';
import {
  GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT,
  GoogleAdsProviderError,
} from '@/lib/google-ads/provider';
import { accountDiscoveryErrorResponse } from './discovery-error-response';

describe('accountDiscoveryErrorResponse', () => {
  it('marks bounded traversal failures as retryable without exposing provider details', async () => {
    const response = accountDiscoveryErrorResponse(
      new GoogleAdsProviderError(GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT)
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: GOOGLE_ADS_MANAGER_DISCOVERY_LIMIT,
      retry: true,
    });
  });

  it('keeps unrelated provider failures generic', async () => {
    const response = accountDiscoveryErrorResponse(
      new GoogleAdsProviderError(
        'GOOGLE_ADS_MANAGER_ACCOUNT_DISCOVERY_FAILED',
        503
      )
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to discover Google Ads accounts',
    });
  });
});

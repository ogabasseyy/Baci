import { beforeEach, expect, it, vi } from 'vitest';
import {
  createMockSupabase,
  MERCHANT_ID,
  makeRequest,
  mockGetMerchantFeatureAccess,
  resetMerchantFeatureSchemaMocks,
  testState,
} from './route.test-support';

const secrets = {
  facebook_capi_token: 'fb-private',
  tiktok_access_token: 'tt-private',
  snapchat_capi_token: 'snap-private',
  ga4_api_secret: 'ga-private',
};
beforeEach(() => {
  vi.clearAllMocks();
  resetMerchantFeatureSchemaMocks();
  testState.authResult = {
    user: { id: 'owner' },
    supabase: createMockSupabase(),
  };
  testState.accessResult = { merchantId: MERCHANT_ID, role: 'owner' };
  testState.csrfValid = true;
  testState.hasSettingsEdit = true;
  testState.hasSettingsView = true;
  testState.settingsData = { merchant_id: MERCHANT_ID, ...secrets };
  testState.settingsError = null;
  testState.updateData = { ...secrets };
  testState.updateError = null;
  testState.upsertData = { ...secrets };
  testState.upsertError = null;
  mockGetMerchantFeatureAccess.mockResolvedValue({
    allowed: true,
    error: null,
  });
});
it.each([
  'GET',
  'PATCH',
  'PUT',
] as const)('%s never returns saved credentials without custom settings', async (method) => {
  const route = await import('./route');
  const response = await route[method](
    makeRequest(
      method,
      method === 'GET' ? undefined : { reviews_enabled: true }
    )
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  for (const [key, value] of Object.entries(secrets)) {
    expect(JSON.stringify(body)).not.toContain(value);
    expect(body[key]).toBeNull();
    expect(body[`${key}_configured`]).toBe(true);
  }
  expect(testState.selectFilter).toEqual({
    column: 'merchant_id',
    value: MERCHANT_ID,
  });
});
it.each([
  'PATCH',
  'PUT',
] as const)('%s retains blanks and accepts explicit disconnect or replacement', async (method) => {
  const route = await import('./route');
  await route[method](
    makeRequest(method, {
      facebook_capi_token: '  ',
      tiktok_access_token: null,
      snapchat_capi_token: 'new-token',
    })
  );
  const payload =
    method === 'PATCH' ? testState.updatePayload : testState.upsertPayload;
  expect(payload).toMatchObject({
    tiktok_access_token: null,
    snapchat_capi_token: 'new-token',
  });
  if (method === 'PUT')
    expect(payload).toMatchObject({
      facebook_capi_token: 'fb-private',
      ga4_api_secret: 'ga-private',
    });
  else expect(payload).not.toHaveProperty('facebook_capi_token');
});

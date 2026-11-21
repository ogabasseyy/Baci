import { beforeEach, describe, expect, it, vi } from 'vitest';
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
  testState.presenceData = Object.fromEntries(
    Object.keys(secrets).map((key) => [key, true])
  );
  testState.settingsData = { merchant_id: MERCHANT_ID };
  testState.settingsError = null;
  testState.updateData = { merchant_id: MERCHANT_ID };
  testState.updateError = null;
  testState.upsertData = { merchant_id: MERCHANT_ID };
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
  // Both routes write secrets with a plain UPDATE; PUT's upsert never carries them
  // (an upsert that names a secret column needs SELECT on it and would fail).
  const payload = testState.updatePayload;
  if (method === 'PUT') {
    for (const key of Object.keys(secrets))
      expect(testState.upsertPayload).not.toHaveProperty(key);
  }
  expect(payload).toMatchObject({
    tiktok_access_token: null,
    snapchat_capi_token: 'new-token',
  });
  // The session cannot read stored secrets, so a blank must never write one back.
  expect(payload).not.toHaveProperty('facebook_capi_token');
  expect(payload).not.toHaveProperty('ga4_api_secret');
});

describe('bugfix R2: secret columns are not readable by the signed-in session', () => {
  it.each([
    'GET',
    'PATCH',
    'PUT',
  ] as const)('%s never selects an integration secret column', async (method) => {
    const route = await import('./route');
    const response = await route[method](
      makeRequest(
        method,
        method === 'GET' ? undefined : { reviews_enabled: true }
      )
    );
    expect(response.status).toBe(200);
    expect(testState.selectLog.length).toBeGreaterThan(0);
    for (const projection of testState.selectLog)
      for (const key of Object.keys(secrets))
        expect(projection).not.toContain(key);
  });

  it('reports not configured for secrets the owner has not saved', async () => {
    testState.presenceData = {
      facebook_capi_token: true,
      tiktok_access_token: false,
      snapchat_capi_token: false,
      ga4_api_secret: false,
    };
    const route = await import('./route');
    const body = await (await route.GET(makeRequest('GET'))).json();
    expect(body.facebook_capi_token_configured).toBe(true);
    expect(body.tiktok_access_token_configured).toBe(false);
    expect(body.ga4_api_secret_configured).toBe(false);
  });

  it('fails closed when presence cannot be determined', async () => {
    testState.presenceError = { message: 'boom' };
    testState.presenceData = null;
    const route = await import('./route');
    const response = await route.GET(makeRequest('GET'));
    expect(response.status).toBe(500);
  });
});

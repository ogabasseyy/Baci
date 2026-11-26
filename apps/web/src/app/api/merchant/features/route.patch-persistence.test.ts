import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockSupabase,
  MERCHANT_ID,
  makeRequest,
  resetMerchantFeatureSchemaMocks,
  testState,
} from './route.test-support';

const zohoCalls = () =>
  testState.rpcCalls.filter(
    (call) => call.name === 'set_merchant_zoho_refresh_token'
  );

describe('PATCH /api/merchant/features persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMerchantFeatureSchemaMocks();
    const mockSupa = createMockSupabase();
    testState.authResult = { user: { id: 'user-1' }, supabase: mockSupa };
    testState.accessResult = { merchantId: MERCHANT_ID, role: 'owner' };
    testState.hasSettingsEdit = true;
    testState.settingsData = { merchant_id: MERCHANT_ID };
    testState.settingsError = null;
    testState.insertData = {
      id: 'settings-1',
      merchant_id: MERCHANT_ID,
      loyalty_enabled: true,
    };
    testState.insertError = null;
    testState.insertPayload = null;
    testState.updateData = {
      id: 'settings-1',
      merchant_id: MERCHANT_ID,
      loyalty_enabled: true,
    };
    testState.updateError = null;
    testState.updatePayload = null;
    testState.upsertData = {
      id: 'settings-1',
      merchant_id: MERCHANT_ID,
      loyalty_enabled: true,
    };
    testState.upsertError = null;
    testState.upsertPayload = null;
    testState.throwOnInsert = false;
    testState.csrfValid = true;
  });

  it('does not reset existing Klump settings on sparse PATCH payloads', async () => {
    const { PATCH } = await import('./route');

    const res = await PATCH(makeRequest('PATCH', { loyalty_enabled: true }));

    expect(res.status).toBe(200);
    expect(testState.updatePayload).toMatchObject({
      loyalty_enabled: true,
      rewards_page_enabled: true,
    });
    expect(testState.updatePayload).not.toHaveProperty('klump_enabled');
    expect(testState.updatePayload).not.toHaveProperty('klump_min_amount');
    expect(testState.updatePayload).not.toHaveProperty('klump_max_amount');
    expect(testState.updatePayload).not.toHaveProperty('oxygen_enabled');
  });

  describe('bugfix R2: Zoho tokens never go into custom_settings', () => {
    const zohoBody = {
      custom_settings: {
        zohoCampaigns: {
          accessToken: 'access',
          clientSecret: 'client-secret',
          enabled: false,
          refreshToken: 'new-refresh-token',
        },
      },
    };

    it('saves the refresh token through the protected function and keeps it out of the write', async () => {
      const { PATCH } = await import('./route');
      testState.settingsData = {
        merchant_id: MERCHANT_ID,
        custom_settings: {
          zohoCampaigns: { enabled: true, listKey: 'list-key' },
        },
      };
      testState.updateData = {
        id: 'settings-1',
        merchant_id: MERCHANT_ID,
        custom_settings: {
          zohoCampaigns: { enabled: false, listKey: 'list-key' },
        },
      };

      const res = await PATCH(makeRequest('PATCH', zohoBody));
      const json = await res.json();

      expect(res.status).toBe(200);
      expect(zohoCalls()).toEqual([
        {
          name: 'set_merchant_zoho_refresh_token',
          args: {
            p_merchant_id: MERCHANT_ID,
            p_refresh_token: 'new-refresh-token',
          },
        },
      ]);
      expect(testState.updatePayload).toMatchObject({
        custom_settings: {
          zohoCampaigns: { enabled: false, listKey: 'list-key' },
        },
      });
      expect(JSON.stringify(testState.updatePayload)).not.toMatch(
        /new-refresh-token|client-secret|access"/
      );
      expect(json.custom_settings).toEqual({
        zohoCampaigns: { enabled: false, listKey: 'list-key' },
      });
    });

    it('clears the stored refresh token when the request sends it blank', async () => {
      const { PATCH } = await import('./route');

      const res = await PATCH(
        makeRequest('PATCH', {
          custom_settings: {
            zohoCampaigns: { enabled: false, refreshToken: '' },
          },
        })
      );

      expect(res.status).toBe(200);
      expect(zohoCalls()).toEqual([
        {
          name: 'set_merchant_zoho_refresh_token',
          args: { p_merchant_id: MERCHANT_ID, p_refresh_token: '' },
        },
      ]);
    });

    it('keeps the stored refresh token when the request does not mention it', async () => {
      const { PATCH } = await import('./route');

      const res = await PATCH(
        makeRequest('PATCH', {
          custom_settings: { zohoCampaigns: { enabled: false } },
        })
      );

      expect(res.status).toBe(200);
      expect(zohoCalls()).toEqual([]);
    });

    it('PUT also routes the refresh token to the protected function', async () => {
      const { PUT } = await import('./route');
      testState.upsertData = { id: 'settings-1', merchant_id: MERCHANT_ID };

      const res = await PUT(makeRequest('PUT', zohoBody));

      expect(res.status).toBe(200);
      expect(zohoCalls()).toHaveLength(1);
      expect(zohoCalls()[0]).toMatchObject({
        name: 'set_merchant_zoho_refresh_token',
        args: { p_refresh_token: 'new-refresh-token' },
      });
      expect(JSON.stringify(testState.upsertPayload)).not.toMatch(
        /new-refresh-token|client-secret/
      );
    });

    it('rejects the whole update with 403 when the caller may not manage integrations', async () => {
      const { PATCH } = await import('./route');
      testState.rpcError = { code: '42501', message: 'not authorized' };
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const res = await PATCH(makeRequest('PATCH', zohoBody));

      expect(res.status).toBe(403);
      expect(testState.updatePayload).toBeNull();
      spy.mockRestore();
    });
  });

  it('seeds API defaults when the first PATCH creates a settings row', async () => {
    const { PATCH } = await import('./route');
    testState.settingsData = null;
    testState.insertData = {
      id: 'settings-1',
      merchant_id: MERCHANT_ID,
      custom_settings: { integrationCardsCollapsed: true },
    };

    const res = await PATCH(
      makeRequest('PATCH', {
        custom_settings: { integrationCardsCollapsed: true },
      })
    );

    expect(res.status).toBe(200);
    expect(testState.insertPayload).toMatchObject({
      merchant_id: MERCHANT_ID,
      custom_settings: { integrationCardsCollapsed: true },
      shipping_providers: [],
      klump_enabled: false,
      vtu_customer_cashback_enabled: false,
    });
    expect(testState.selectColumns).toContain('shipping_providers');
    expect(testState.selectColumns).toContain('custom_settings');
    expect(testState.updatePayload).toBeNull();
  });

  it('retries sparse PATCH as an update if a concurrent first insert wins', async () => {
    const { PATCH } = await import('./route');
    testState.settingsData = null;
    testState.insertError = {
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    };
    testState.updateData = {
      id: 'settings-1',
      merchant_id: MERCHANT_ID,
      loyalty_enabled: true,
      rewards_page_enabled: true,
    };

    const res = await PATCH(makeRequest('PATCH', { loyalty_enabled: true }));

    expect(res.status).toBe(200);
    expect(testState.insertPayload).toMatchObject({
      merchant_id: MERCHANT_ID,
      loyalty_enabled: true,
      rewards_page_enabled: true,
      shipping_providers: [],
    });
    expect(testState.updatePayload).toMatchObject({
      loyalty_enabled: true,
      rewards_page_enabled: true,
    });
    expect(testState.selectColumns).toContain('shipping_providers');
    expect(testState.selectColumns).toContain('custom_settings');
    expect(testState.updatePayload).not.toHaveProperty('shipping_providers');
  });

  it('updates merchant-scoped Klump installment settings', async () => {
    const { PATCH } = await import('./route');

    const res = await PATCH(
      makeRequest('PATCH', {
        klump_enabled: true,
        klump_min_amount: 2500,
        klump_max_amount: 750000,
      })
    );

    expect(res.status).toBe(200);
    expect(testState.updatePayload).toMatchObject({
      klump_enabled: true,
      klump_min_amount: 2500,
      klump_max_amount: 750000,
    });
  });

  it('persists oxygen_enabled true and false via PATCH', async () => {
    const { PATCH } = await import('./route');

    const enableRes = await PATCH(
      makeRequest('PATCH', { oxygen_enabled: true })
    );
    expect(enableRes.status).toBe(200);
    expect(testState.updatePayload).toMatchObject({ oxygen_enabled: true });

    const disableRes = await PATCH(
      makeRequest('PATCH', { oxygen_enabled: false })
    );
    expect(disableRes.status).toBe(200);
    expect(testState.updatePayload).toMatchObject({ oxygen_enabled: false });
  });

  it('returns 500 when PATCH persistence fails', async () => {
    const { PATCH } = await import('./route');
    testState.upsertError = { message: 'DB error' };
    testState.updateError = { message: 'DB error' };

    const res = await PATCH(makeRequest('PATCH', { loyalty_enabled: true }));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to update settings');
  });
});

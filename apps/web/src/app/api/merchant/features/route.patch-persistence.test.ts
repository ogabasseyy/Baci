import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockSupabase,
  MERCHANT_ID,
  makeRequest,
  resetMerchantFeatureSchemaMocks,
  testState,
} from './route.test-support';

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
  });

  it('preserves stored Zoho Campaigns secrets while redacting PATCH responses', async () => {
    const { PATCH } = await import('./route');
    testState.settingsData = {
      merchant_id: MERCHANT_ID,
      custom_settings: {
        zohoCampaigns: {
          enabled: true,
          listKey: 'list-key',
          refreshToken: 'stored-refresh-token',
        },
      },
    };
    testState.updateData = {
      id: 'settings-1',
      merchant_id: MERCHANT_ID,
      custom_settings: {
        zohoCampaigns: {
          enabled: false,
          listKey: 'list-key',
          refreshToken: 'stored-refresh-token',
        },
      },
    };

    const res = await PATCH(
      makeRequest('PATCH', {
        custom_settings: { zohoCampaigns: { enabled: false } },
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(testState.updatePayload).toMatchObject({
      custom_settings: {
        zohoCampaigns: {
          enabled: false,
          listKey: 'list-key',
          refreshToken: 'stored-refresh-token',
        },
      },
    });
    expect(testState.selectFilter).toEqual({
      column: 'merchant_id',
      value: MERCHANT_ID,
    });
    expect(json.custom_settings).toEqual({
      zohoCampaigns: {
        enabled: false,
        listKey: 'list-key',
      },
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

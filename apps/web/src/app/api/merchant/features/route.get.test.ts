import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMockSupabase,
  MERCHANT_ID,
  makeRequest,
  mockGetMerchantFeatureAccess,
  resetMerchantFeatureSchemaMocks,
  testState,
} from './route.test-support';

describe('GET /api/merchant/features', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetMerchantFeatureSchemaMocks();
    const mockSupa = createMockSupabase();
    testState.authResult = { user: { id: 'user-1' }, supabase: mockSupa };
    testState.accessResult = { merchantId: MERCHANT_ID, role: 'owner' };
    testState.hasSettingsView = true;
    testState.hasSettingsEdit = true;
    testState.hasMarketingView = true;
    testState.hasDashboardView = true;
    testState.settingsData = { id: 'settings-1', merchant_id: MERCHANT_ID };
    testState.settingsError = null;
    testState.insertData = null;
    testState.insertError = null;
    testState.insertPayload = null;
    testState.updateData = null;
    testState.updateError = null;
    testState.updatePayload = null;
    testState.upsertPayload = null;
    testState.selectColumns = null;
    testState.throwOnInsert = false;
    testState.csrfValid = true;
    mockGetMerchantFeatureAccess.mockResolvedValue({
      allowed: true,
      error: null,
    });
  });

  it('selects all VTU category and customer cashback fields', async () => {
    const { GET } = await import('./route');

    const response = await GET(makeRequest('GET'));

    expect(response.status).toBe(200);
    expect(testState.selectColumns).toContain('agentic_checkout_enabled');
    expect(testState.selectColumns).toContain('repairs_catalog_enabled');
    expect(testState.selectColumns).toContain('klump_enabled');
    expect(testState.selectColumns).toContain('klump_min_amount');
    expect(testState.selectColumns).toContain('klump_max_amount');
    expect(testState.selectColumns).toContain('vtu_electricity_enabled');
    expect(testState.selectColumns).toContain('vtu_tv_enabled');
    expect(testState.selectColumns).toContain('vtu_betting_enabled');
    expect(testState.selectColumns).toContain('vtu_customer_cashback_enabled');
    expect(testState.selectColumns).toContain('vtu_customer_cashback_rate');
    expect(testState.selectColumns).not.toContain(
      'offline_conversions_enabled'
    );
  });

  it('returns read-only default settings with VTU customer cashback disabled by default', async () => {
    const { GET } = await import('./route');
    testState.settingsData = null;
    testState.settingsError = null;
    testState.throwOnInsert = true;

    const response = await GET(makeRequest('GET'));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      id: null,
      merchant_id: MERCHANT_ID,
      agentic_checkout_enabled: true,
      repairs_catalog_enabled: false,
      klump_enabled: false,
      klump_min_amount: 10000,
      klump_max_amount: 1000000,
      vtu_customer_cashback_enabled: false,
      vtu_customer_cashback_rate: 50,
      created_at: null,
      updated_at: null,
    });
    expect(data).not.toHaveProperty('blog_discover_image_validation_enabled');
    expect(data).not.toHaveProperty('juicyway_enabled');
    expect(data).not.toHaveProperty('wallet_order_auto_debit_enabled');
    expect(data).not.toHaveProperty('offline_conversions_enabled');
  });

  it('returns 401 when not authenticated', async () => {
    const { GET } = await import('./route');
    testState.authResult = { error: 'Unauthorized' };

    const res = await GET(makeRequest('GET'));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(res.headers.get('Cache-Control')).toBe(
      'private, no-store, no-cache, max-age=0, must-revalidate'
    );
    expect(json.error).toBe('Unauthorized');
  });

  it('returns 404 when merchant not found', async () => {
    const { GET } = await import('./route');
    testState.accessResult = null;

    const res = await GET(makeRequest('GET'));
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toBe('Merchant not found');
  });

  it('returns 403 when no relevant permission', async () => {
    const { GET } = await import('./route');
    testState.hasSettingsView = false;
    testState.hasMarketingView = false;
    testState.hasDashboardView = false;

    const res = await GET(makeRequest('GET'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toBe('Permission denied');
  });

  it('returns settings when found', async () => {
    const { GET } = await import('./route');

    const res = await GET(makeRequest('GET'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(
      'private, no-store, no-cache, max-age=0, must-revalidate'
    );
    expect(json.id).toBe('settings-1');
  });

  it('redacts Zoho Campaigns secrets from custom_settings responses', async () => {
    const { GET } = await import('./route');
    testState.settingsData = {
      id: 'settings-1',
      merchant_id: MERCHANT_ID,
      custom_settings: {
        dashboardTheme: 'compact',
        zohoCampaigns: {
          apiDomain: 'https://campaigns.zoho.eu',
          enabled: true,
          refreshToken: 'secret-refresh-token',
        },
        zoho_campaigns: {
          client_secret: 'secret-client',
          refresh_token: 'secret-refresh-token-2',
          topic_id: 'topic-1',
        },
      },
    };

    const res = await GET(makeRequest('GET'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.custom_settings).toEqual({
      dashboardTheme: 'compact',
      zohoCampaigns: {
        apiDomain: 'https://campaigns.zoho.eu',
        enabled: true,
      },
      zoho_campaigns: { topic_id: 'topic-1' },
    });
  });

  it('keeps GET read-only when no settings exist', async () => {
    const { GET } = await import('./route');
    testState.settingsData = null;
    testState.settingsError = null;
    testState.throwOnInsert = true;

    const res = await GET(makeRequest('GET'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toMatchObject({
      merchant_id: MERCHANT_ID,
      shipping_providers: [],
    });
  });

  it('returns 500 when DB error occurs', async () => {
    const { GET } = await import('./route');
    testState.settingsError = { code: 'UNEXPECTED', message: 'DB error' };

    const res = await GET(makeRequest('GET'));
    const json = await res.json();

    expect(res.status).toBe(500);
    expect(json.error).toBe('Failed to fetch settings');
  });
});

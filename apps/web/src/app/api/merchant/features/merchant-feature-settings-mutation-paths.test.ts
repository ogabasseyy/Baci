import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const routeMocks = vi.hoisted(() => ({
  from: vi.fn(),
  hasPermission: vi.fn(),
  select: vi.fn(),
  selectEq: vi.fn(),
  selectMaybeSingle: vi.fn(),
  update: vi.fn(),
  updateEq: vi.fn(),
  upsert: vi.fn(),
  revalidateFeatures: vi.fn(),
  revalidateMerchant: vi.fn(),
  revalidateRepairsCatalog: vi.fn(),
  writeSelect: vi.fn(),
  writeSingle: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: () =>
    Promise.resolve({
      supabase: {
        from: routeMocks.from,
        rpc: () => Promise.resolve({ data: {}, error: null }),
      },
      user: { id: 'task5-user' },
    }),
  hasPermission: (...args: unknown[]) => routeMocks.hasPermission(...args),
}));

const merchantId = '22222222-2222-4222-8222-222222222222';

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(() =>
    Promise.resolve({
      merchantId,
      staffAccess: { isOwner: true, isStaff: false, permissions: {} },
    })
  ),
  toUserAccess: vi.fn(() => ({ merchantId, role: 'owner' })),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateFeatures: routeMocks.revalidateFeatures,
  revalidateMerchant: routeMocks.revalidateMerchant,
  revalidateRepairsCatalog: routeMocks.revalidateRepairsCatalog,
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: () => Promise.resolve({ response: null, valid: true }),
}));

vi.mock('@/lib/merchant-feature-gates', () => ({
  getMerchantFeatureAccess: vi.fn(),
  merchantFeatureUpgradeResponse: () =>
    Response.json({ error: 'Growth integrations require Baci Pro' }),
}));

vi.mock('@/lib/merchant-feature-settings-redaction', () => ({
  preserveZohoCampaignSecretCustomSettings: (
    customSettings: Record<string, unknown> | undefined
  ) => customSettings ?? {},
  redactMerchantFeatureSettingsResponse: <T>(settings: T) => settings,
}));

function makeRequest(method: 'PATCH' | 'PUT', body: Record<string, unknown>) {
  return new NextRequest('http://localhost:3000/api/merchant/features', {
    body: JSON.stringify({ ...body, merchantId }),
    headers: { 'Content-Type': 'application/json' },
    method,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  routeMocks.hasPermission.mockReturnValue(true);
  routeMocks.selectMaybeSingle.mockResolvedValue({
    data: { custom_settings: {} },
    error: null,
  });
  routeMocks.selectEq.mockReturnValue({
    maybeSingle: routeMocks.selectMaybeSingle,
  });
  routeMocks.select.mockReturnValue({ eq: routeMocks.selectEq });
  routeMocks.writeSingle.mockResolvedValue({
    data: { id: 'task5-settings', merchant_id: merchantId },
    error: null,
  });
  routeMocks.writeSelect.mockReturnValue({ single: routeMocks.writeSingle });
  routeMocks.updateEq.mockReturnValue({ select: routeMocks.writeSelect });
  routeMocks.update.mockReturnValue({ eq: routeMocks.updateEq });
  routeMocks.upsert.mockReturnValue({ select: routeMocks.writeSelect });
  routeMocks.from.mockReturnValue({
    select: routeMocks.select,
    update: routeMocks.update,
    upsert: routeMocks.upsert,
  });
});

describe('merchant feature settings audited mutation paths', () => {
  it('sends audited gateway, checkout, and threshold values through PATCH', async () => {
    // Arrange
    const { PATCH } = await import('./route');

    // Act
    const response = await PATCH(
      makeRequest('PATCH', {
        checkout_collect_phone: false,
        credit_direct_min_amount: 20_000,
        free_shipping_threshold: -1,
        oxygen_enabled: true,
        paystack_enabled: false,
        preferred_local_gateway: 'korapay',
      })
    );

    // Assert
    expect(response.status).toBe(200);
    expect(routeMocks.from).toHaveBeenCalledWith('merchant_feature_settings');
    expect(routeMocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        checkout_collect_phone: false,
        credit_direct_min_amount: 20_000,
        free_shipping_threshold: -1,
        oxygen_enabled: true,
        paystack_enabled: false,
        preferred_local_gateway: 'korapay',
      })
    );
    expect(routeMocks.updateEq).toHaveBeenCalledWith('merchant_id', merchantId);
    expect(routeMocks.upsert).not.toHaveBeenCalled();
  });

  it('sends audited gateway, checkout, and threshold values through PUT', async () => {
    // Arrange
    const { PUT } = await import('./route');

    // Act
    const response = await PUT(
      makeRequest('PUT', {
        checkout_require_account: true,
        credit_direct_enabled: true,
        free_shipping_threshold: 50_000,
        korapay_enabled: true,
        oxygen_enabled: false,
        preferred_international_gateway: 'paystack',
      })
    );

    // Assert
    expect(response.status).toBe(200);
    expect(routeMocks.from).toHaveBeenCalledWith('merchant_feature_settings');
    expect(routeMocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        checkout_require_account: true,
        credit_direct_enabled: true,
        free_shipping_threshold: 50_000,
        korapay_enabled: true,
        merchant_id: merchantId,
        oxygen_enabled: false,
        preferred_international_gateway: 'paystack',
      }),
      { onConflict: 'merchant_id' }
    );
    expect(routeMocks.update).not.toHaveBeenCalled();
    expect(routeMocks.hasPermission).toHaveBeenCalledWith(
      expect.objectContaining({ merchantId }),
      'settings',
      'edit'
    );
  });

  it('does not revalidate when PATCH update persistence fails', async () => {
    // Arrange
    const { PATCH } = await import('./route');
    routeMocks.writeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST001', message: 'update failed' },
    });

    // Act
    const response = await PATCH(
      makeRequest('PATCH', { paystack_enabled: false })
    );

    // Assert
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to update settings',
    });
    expect(routeMocks.revalidateFeatures).not.toHaveBeenCalled();
    expect(routeMocks.revalidateMerchant).not.toHaveBeenCalled();
    expect(routeMocks.revalidateRepairsCatalog).not.toHaveBeenCalled();
  });

  it('does not revalidate when PUT upsert persistence fails', async () => {
    // Arrange
    const { PUT } = await import('./route');
    routeMocks.writeSingle.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST001', message: 'upsert failed' },
    });

    // Act
    const response = await PUT(makeRequest('PUT', { paystack_enabled: false }));

    // Assert
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Failed to save settings',
    });
    expect(routeMocks.revalidateFeatures).not.toHaveBeenCalled();
    expect(routeMocks.revalidateMerchant).not.toHaveBeenCalled();
    expect(routeMocks.revalidateRepairsCatalog).not.toHaveBeenCalled();
  });
});

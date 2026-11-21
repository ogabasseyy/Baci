import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  checkCsrfProtection: vi.fn(),
  getMerchantForApiRequest: vi.fn(),
  hasPermission: vi.fn(),
  revalidateFeatures: vi.fn(),
  revalidateMerchant: vi.fn(),
  revalidateRepairsCatalog: vi.fn(),
  toUserAccess: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mocks.authenticateApiRequest(...args),
  hasPermission: (...args: unknown[]) => mocks.hasPermission(...args),
}));

vi.mock('@/lib/cache-revalidation', () => ({
  revalidateFeatures: (...args: unknown[]) => mocks.revalidateFeatures(...args),
  revalidateMerchant: (...args: unknown[]) => mocks.revalidateMerchant(...args),
  revalidateRepairsCatalog: (...args: unknown[]) =>
    mocks.revalidateRepairsCatalog(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) =>
    mocks.checkCsrfProtection(...args),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: (...args: unknown[]) =>
    mocks.getMerchantForApiRequest(...args),
  toUserAccess: (...args: unknown[]) => mocks.toUserAccess(...args),
}));

vi.mock('@/lib/merchant-feature-gates', () => ({
  getMerchantFeatureAccess: vi.fn(),
  merchantFeatureUpgradeResponse: vi.fn(),
}));

vi.mock('@/lib/merchant-feature-settings-defaults', () => ({
  merchantFeatureSettingsDefaults: { buildFields: () => ({}) },
}));

vi.mock('@/lib/merchant-feature-settings-redaction', () => ({
  preserveZohoCampaignSecretCustomSettings: (value: unknown) => value,
  redactMerchantFeatureSettingsResponse: (value: unknown) => value,
}));

vi.mock('@/schemas/merchant-features', () => ({
  merchantFeatureSettingsPatchSchema: {
    safeParse: (value: Record<string, unknown>) => ({
      success: true as const,
      data: value,
    }),
  },
}));

import { GET, PATCH, PUT } from './route';

const selectedMerchantId = '22222222-2222-4222-8222-222222222222';
let merchantIdFilter: string | null;
let updatePayload: Record<string, unknown> | null;
let upsertPayload: Record<string, unknown> | null;

function createSupabase() {
  const updateEq = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn(() =>
        Promise.resolve({
          data: {
            custom_settings: {},
            id: 'settings-b',
            merchant_id: selectedMerchantId,
          },
          error: null,
        })
      ),
    })),
  }));

  return {
    rpc: vi.fn(() => Promise.resolve({ data: {}, error: null })),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn((_column: string, merchantId: string) => {
          merchantIdFilter = merchantId;
          return {
            maybeSingle: vi.fn(() =>
              Promise.resolve({
                data: {
                  custom_settings: {},
                  id: 'settings-b',
                  merchant_id: selectedMerchantId,
                },
                error: null,
              })
            ),
          };
        }),
      })),
      update: vi.fn((payload: Record<string, unknown>) => {
        updatePayload = payload;
        return { eq: updateEq };
      }),
      upsert: vi.fn((payload: Record<string, unknown>) => {
        upsertPayload = payload;
        return {
          select: vi.fn(() => ({
            single: vi.fn(() =>
              Promise.resolve({
                data: {
                  custom_settings: {},
                  id: 'settings-b',
                  merchant_id: selectedMerchantId,
                },
                error: null,
              })
            ),
          })),
        };
      }),
    })),
  };
}

describe('selected merchant feature settings routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    merchantIdFilter = null;
    updatePayload = null;
    upsertPayload = null;

    const supabase = createSupabase();
    mocks.authenticateApiRequest.mockResolvedValue({
      error: null,
      supabase,
      user: { id: 'user-1' },
    });
    mocks.checkCsrfProtection.mockResolvedValue({ valid: true });
    mocks.getMerchantForApiRequest.mockResolvedValue({
      merchantId: selectedMerchantId,
      staffAccess: { isOwner: true, isStaff: false, permissions: {} },
    });
    mocks.toUserAccess.mockReturnValue({
      merchantId: selectedMerchantId,
      permissions: {},
      role: 'owner',
    });
    mocks.hasPermission.mockReturnValue(true);
  });

  it('queries the explicitly selected merchant after authorization', async () => {
    const response = await GET(
      new NextRequest(
        `http://localhost/api/merchant/features?merchantId=${selectedMerchantId}`
      )
    );

    expect(response.status).toBe(200);
    expect(merchantIdFilter).toBe(selectedMerchantId);
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId: selectedMerchantId }
    );
  });

  it('rejects GET when the selected merchant ID is omitted', async () => {
    const response = await GET(
      new NextRequest('http://localhost/api/merchant/features')
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid merchant ID',
    });
    expect(merchantIdFilter).toBeNull();
    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it('strips merchantId and writes and revalidates only the selected merchant', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/merchant/features', {
        body: JSON.stringify({
          loyalty_enabled: true,
          merchantId: selectedMerchantId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      })
    );

    expect(response.status).toBe(200);
    expect(updatePayload).toMatchObject({
      loyalty_enabled: true,
      rewards_page_enabled: true,
    });
    expect(updatePayload).not.toHaveProperty('merchantId');
    expect(mocks.revalidateFeatures).toHaveBeenCalledWith(selectedMerchantId);
    expect(mocks.revalidateMerchant).toHaveBeenCalledWith(selectedMerchantId);
  });

  it('replaces settings for the explicitly selected merchant', async () => {
    const response = await PUT(
      new NextRequest('http://localhost/api/merchant/features', {
        body: JSON.stringify({
          loyalty_enabled: true,
          merchantId: selectedMerchantId,
        }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PUT',
      })
    );

    expect(response.status).toBe(200);
    expect(merchantIdFilter).toBe(selectedMerchantId);
    expect(upsertPayload).toMatchObject({
      loyalty_enabled: true,
      merchant_id: selectedMerchantId,
    });
    expect(upsertPayload).not.toHaveProperty('merchantId');
    expect(mocks.revalidateFeatures).toHaveBeenCalledWith(selectedMerchantId);
    expect(mocks.revalidateMerchant).toHaveBeenCalledWith(selectedMerchantId);
    expect(mocks.getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId: selectedMerchantId }
    );
  });

  it('rejects an explicitly null PATCH merchantId before writing settings', async () => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/merchant/features', {
        body: JSON.stringify({ loyalty_enabled: true, merchantId: null }),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid merchant ID',
    });
    expect(updatePayload).toBeNull();
    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it.each<readonly [unknown]>([
    [null],
    ['loyalty_enabled=true'],
    [['loyalty_enabled']],
  ])('rejects a non-object PATCH body before resolving or writing settings: %j', async (body) => {
    const response = await PATCH(
      new NextRequest('http://localhost/api/merchant/features', {
        body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json' },
        method: 'PATCH',
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: 'Invalid input',
    });
    expect(updatePayload).toBeNull();
    expect(mocks.getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it('rejects an unauthorized selected merchant without querying settings', async () => {
    mocks.getMerchantForApiRequest.mockResolvedValueOnce(null);

    const response = await GET(
      new NextRequest(
        `http://localhost/api/merchant/features?merchantId=${selectedMerchantId}`
      )
    );

    expect(response.status).toBe(404);
    expect(merchantIdFilter).toBeNull();
  });
});

import { NextRequest } from 'next/server';
import { beforeEach, vi } from 'vitest';

vi.mock('@/env', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
  getSupabaseAnonKey: () => 'test-anon-key',
  getSupabaseServiceRoleKey: () => 'test-service-role-key',
  getRootDomain: () => 'localhost',
}));

const mockRevalidateFeatures = vi.fn();
const mockRevalidateMerchant = vi.fn();
const mockRevalidateRepairsCatalog = vi.fn();
vi.mock('@/lib/cache-revalidation', () => ({
  revalidateFeatures: (...args: unknown[]) => mockRevalidateFeatures(...args),
  revalidateMerchant: (...args: unknown[]) => mockRevalidateMerchant(...args),
  revalidateRepairsCatalog: (...args: unknown[]) =>
    mockRevalidateRepairsCatalog(...args),
}));

const mockGetMerchantFeatureAccess = vi.fn();
vi.mock('@/lib/merchant-feature-gates', () => ({
  getMerchantFeatureAccess: (...args: unknown[]) =>
    mockGetMerchantFeatureAccess(...args),
  merchantFeatureUpgradeResponse: () =>
    Response.json(
      {
        code: 'requires_upgrade',
        error: 'Growth integrations require Baci Pro',
      },
      { status: 402 }
    ),
}));

const MERCHANT_ID = '11111111-1111-4111-8111-111111111111';

interface TestState {
  accessResult: { merchantId: string; role: string } | null;
  authResult: {
    error?: string;
    user?: { id: string } | null;
    supabase?: ReturnType<typeof createMockSupabase>;
  };
  csrfValid: boolean;
  hasDashboardView: boolean;
  hasMarketingView: boolean;
  hasSettingsEdit: boolean;
  hasSettingsView: boolean;
  insertData: unknown;
  insertError: unknown;
  insertPayload: unknown;
  presenceData: unknown;
  presenceError: unknown;
  rpcCalls: Array<{ name: string; args: unknown }>;
  rpcError: { code?: string; message: string } | null;
  selectColumns: string | null;
  selectLog: string[];
  selectFilter: { column: string; value: unknown } | null;
  settingsData: unknown;
  settingsError: unknown;
  throwOnInsert: boolean;
  updateData: unknown;
  updateError: unknown;
  updatePayload: unknown;
  upsertData: unknown;
  upsertError: unknown;
  upsertPayload: unknown;
}

function createInitialTestState(): TestState {
  return {
    accessResult: null,
    authResult: {},
    csrfValid: true,
    hasDashboardView: true,
    hasMarketingView: true,
    hasSettingsEdit: true,
    hasSettingsView: true,
    insertData: null,
    insertError: null,
    insertPayload: null,
    presenceData: {
      facebook_capi_token: false,
      tiktok_access_token: false,
      snapchat_capi_token: false,
      ga4_api_secret: false,
    },
    presenceError: null,
    rpcCalls: [],
    rpcError: null,
    selectColumns: null,
    selectLog: [],
    selectFilter: null,
    settingsData: {
      id: 'settings-1',
      merchant_id: MERCHANT_ID,
      loyalty_enabled: false,
    },
    settingsError: null,
    throwOnInsert: false,
    updateData: null,
    updateError: null,
    updatePayload: null,
    upsertData: null,
    upsertError: null,
    upsertPayload: null,
  };
}

const testState: TestState = createInitialTestState();

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(() =>
    Promise.resolve({
      valid: testState.csrfValid,
      response: testState.csrfValid
        ? null
        : new Response(JSON.stringify({ error: 'CSRF validation failed' }), {
            status: 403,
          }),
    })
  ),
}));

const merchantFeatureSchemaMocks = vi.hoisted(() => ({
  patchSafeParse: vi.fn(),
  replacementSafeParse: vi.fn(),
}));

function resetMerchantFeatureSchemaMocks() {
  merchantFeatureSchemaMocks.patchSafeParse.mockImplementation(
    (data: Record<string, unknown>) => ({ success: true as const, data })
  );
  merchantFeatureSchemaMocks.replacementSafeParse.mockImplementation(
    (data: Record<string, unknown>) => ({
      success: true as const,
      data: {
        ...data,
        klump_enabled: false,
        klump_min_amount: 10_000,
        klump_max_amount: 1_000_000,
      },
    })
  );
}

vi.mock('@/schemas/merchant-features', () => ({
  merchantFeatureSettingsPatchSchema: {
    safeParse: (data: Record<string, unknown>) =>
      merchantFeatureSchemaMocks.patchSafeParse(data),
  },
  merchantFeatureSettingsSchema: {
    partial: () => ({
      safeParse: (data: Record<string, unknown>) =>
        merchantFeatureSchemaMocks.replacementSafeParse(data),
    }),
  },
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(() => Promise.resolve(testState.authResult)),
  hasPermission: vi.fn((_access: unknown, resource: string, action: string) => {
    if (resource === 'settings' && action === 'view')
      return testState.hasSettingsView;
    if (resource === 'settings' && action === 'edit')
      return testState.hasSettingsEdit;
    if (resource === 'marketing' && action === 'view')
      return testState.hasMarketingView;
    if (resource === 'dashboard' && action === 'view')
      return testState.hasDashboardView;
    return false;
  }),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(() =>
    Promise.resolve(
      testState.accessResult
        ? {
            merchantId: testState.accessResult.merchantId,
            staffAccess: { isOwner: true, isStaff: false, permissions: {} },
          }
        : null
    )
  ),
  toUserAccess: vi.fn(() => testState.accessResult),
}));

function createMockSupabase() {
  return {
    rpc: vi.fn((name: string, args: unknown) => {
      testState.rpcCalls.push({ name, args });
      if (name === 'get_merchant_integration_secret_presence') {
        return Promise.resolve({
          data: testState.presenceData,
          error: testState.presenceError,
        });
      }
      return Promise.resolve({ data: null, error: testState.rpcError });
    }),
    from: vi.fn((table: string) => {
      if (table === 'merchant_feature_settings') {
        return {
          select: vi.fn((columns: string) => {
            testState.selectColumns = columns;
            testState.selectLog.push(columns);
            return {
              eq: vi.fn((column: string, value: unknown) => {
                testState.selectFilter = { column, value };
                return {
                  single: vi.fn(() =>
                    Promise.resolve({
                      data: testState.settingsData,
                      error: testState.settingsError,
                    })
                  ),
                  maybeSingle: vi.fn(() =>
                    Promise.resolve({
                      data: testState.settingsData,
                      error: testState.settingsError,
                    })
                  ),
                };
              }),
            };
          }),
          insert: vi.fn((payload: unknown) => {
            if (testState.throwOnInsert) {
              throw new Error('GET must not persist default settings');
            }
            testState.insertPayload = payload;
            return {
              select: vi.fn((columns: string) => {
                testState.selectColumns = columns;
                testState.selectLog.push(columns);
                return {
                  single: vi.fn(() =>
                    Promise.resolve({
                      data: testState.insertData,
                      error: testState.insertError,
                    })
                  ),
                };
              }),
            };
          }),
          update: vi.fn((payload: unknown) => {
            testState.updatePayload = payload;
            return {
              eq: vi.fn().mockReturnValue({
                select: vi.fn((columns: string) => {
                  testState.selectColumns = columns;
                  testState.selectLog.push(columns);
                  return {
                    single: vi.fn(() =>
                      Promise.resolve({
                        data: testState.updateData,
                        error: testState.updateError,
                      })
                    ),
                  };
                }),
              }),
            };
          }),
          upsert: vi.fn((payload: unknown) => {
            testState.upsertPayload = payload;
            return {
              select: vi.fn((columns: string) => {
                testState.selectColumns = columns;
                testState.selectLog.push(columns);
                return {
                  single: vi.fn(() =>
                    Promise.resolve({
                      data: testState.upsertData,
                      error: testState.upsertError,
                    })
                  ),
                };
              }),
            };
          }),
        };
      }
      return { select: vi.fn().mockReturnThis() };
    }),
  };
}

function makeRequest(
  method: string,
  body?: Record<string, unknown>
): NextRequest {
  const url = new URL('http://localhost:3000/api/merchant/features');
  if (method === 'GET') url.searchParams.set('merchantId', MERCHANT_ID);
  return new NextRequest(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body:
      method === 'GET'
        ? undefined
        : JSON.stringify({ merchantId: MERCHANT_ID, ...body }),
  });
}

beforeEach(() => {
  Object.assign(testState, createInitialTestState());
  resetMerchantFeatureSchemaMocks();
  mockGetMerchantFeatureAccess.mockReset();
  mockGetMerchantFeatureAccess.mockResolvedValue({
    allowed: true,
    error: null,
  });
});

export {
  createMockSupabase,
  MERCHANT_ID,
  makeRequest,
  merchantFeatureSchemaMocks,
  mockGetMerchantFeatureAccess,
  mockRevalidateFeatures,
  mockRevalidateMerchant,
  mockRevalidateRepairsCatalog,
  resetMerchantFeatureSchemaMocks,
  testState,
};

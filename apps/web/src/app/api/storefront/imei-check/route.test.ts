import { createHash, createHmac } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mockAuthenticateApiRequest: vi.fn(),
  mockCheckCsrfProtection: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockCreateAdminClient: vi.fn(),
  mockFinalizePetrockLookup: vi.fn(),
  mockMarkPetrockSubmissionUnknown: vi.fn(),
  mockPetrockGetOrder: vi.fn(),
  mockPetrockSubmitOrder: vi.fn(),
  mockReadCustomerWalletBalance: vi.fn(),
  mockReadPetrockProductSnapshot: vi.fn(),
  mockRecordPetrockSubmission: vi.fn(),
  mockRedeemPetrockWalletAndBeginSubmission: vi.fn(),
  mockRedeemImeiWalletPayment: vi.fn(),
  mockRefundImeiWalletPayment: vi.fn(),
  mockRequestSickwCheck: vi.fn(),
  mockResolveImeiCustomer: vi.fn(),
  mockResolveStorefrontMerchantFromRequest: vi.fn(),
}));

vi.mock('@/env', () => ({
  getImeiDisabledTierKeys: () =>
    (process.env.IMEI_DISABLED_TIERS ?? '').split(',').filter(Boolean),
  getImeiHashSalt: () => process.env.IMEI_HASH_SALT,
  getImeiIdentifierEncryptionKey: () =>
    process.env.IMEI_IDENTIFIER_ENCRYPTION_KEY,
  getPetrockConfig: () =>
    process.env.PETROCK_API_TOKEN
      ? {
          baseUrl:
            process.env.PETROCK_API_BASE_URL ??
            'https://api.petrock.biz/api/reseller/v1',
          token: process.env.PETROCK_API_TOKEN,
        }
      : null,
  getPetrockEnabledTierKeys: () =>
    (process.env.PETROCK_ENABLED_TIERS ?? '').split(',').filter(Boolean),
  getRootDomain: () => 'usebaci.com',
  getSickwApiKey: () => process.env.SICKW_API_KEY,
  isPetrockEnabled: () => process.env.PETROCK_ENABLED === 'true',
}));

vi.mock('@/lib/imei-providers/petrock/petrock-client', () => ({
  createPetrockClient: () => ({
    getOrder: mocks.mockPetrockGetOrder,
    submitOrder: mocks.mockPetrockSubmitOrder,
  }),
}));

vi.mock('@/lib/imei-providers/petrock/petrock-lookup-state', () => ({
  finalizePetrockLookup: mocks.mockFinalizePetrockLookup,
  markPetrockSubmissionUnknown: mocks.mockMarkPetrockSubmissionUnknown,
  readPetrockProductSnapshot: mocks.mockReadPetrockProductSnapshot,
  recordPetrockSubmission: mocks.mockRecordPetrockSubmission,
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: (...args: unknown[]) =>
    mocks.mockAuthenticateApiRequest(...args),
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: (...args: unknown[]) =>
    mocks.mockCheckCsrfProtection(...args),
}));

vi.mock('@/lib/rate-limit', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/rate-limit')>(
      '@/lib/rate-limit'
    );
  return {
    ...actual,
    checkRateLimit: (...args: unknown[]) => mocks.mockCheckRateLimit(...args),
  };
});

vi.mock('@/lib/storefront-merchant', () => ({
  resolveStorefrontMerchantFromRequest: (...args: unknown[]) =>
    mocks.mockResolveStorefrontMerchantFromRequest(...args),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => mocks.mockCreateAdminClient(),
}));

vi.mock('@/lib/imei-lookup-fulfillment', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/imei-lookup-fulfillment')
  >('@/lib/imei-lookup-fulfillment');
  return {
    ...actual,
    readCustomerWalletBalance: (...args: unknown[]) =>
      mocks.mockReadCustomerWalletBalance(...args),
    redeemImeiWalletPayment: (...args: unknown[]) =>
      mocks.mockRedeemImeiWalletPayment(...args),
    redeemImeiWalletAndBeginProviderSubmission: (...args: unknown[]) =>
      mocks.mockRedeemPetrockWalletAndBeginSubmission(...args),
    refundImeiWalletPayment: (...args: unknown[]) =>
      mocks.mockRefundImeiWalletPayment(...args),
    requestSickwCheck: (...args: unknown[]) =>
      mocks.mockRequestSickwCheck(...args),
    resolveImeiCustomer: (...args: unknown[]) =>
      mocks.mockResolveImeiCustomer(...args),
  };
});

interface ImeiLookupRow {
  amount_ngn: number;
  cached_response: Record<string, unknown> | null;
  cached_status: number | null;
  customer_id: string;
  device_category?: string | null;
  id: string;
  idempotency_key: string;
  imei_hash: string;
  merchant_id: string;
  status: string;
  tier: string;
}

const VALID_IMEI = '354442067957452';
const IDEMPOTENCY_KEY = '11111111-1111-4111-8111-111111111111';

function hashImeiForTest(imei: string) {
  const salt = process.env.IMEI_HASH_SALT;
  if (!salt) {
    throw new Error('IMEI_HASH_SALT must be stubbed for hash assertions');
  }
  return createHmac('sha256', salt).update(imei).digest('hex');
}

function createRequest(
  body: Record<string, unknown> = { imei: VALID_IMEI, tier: 'full' },
  headers: Record<string, string> = {},
  url = 'https://ogabassey.usebaci.com/api/storefront/imei-check'
) {
  const requestUrl = new URL(url);
  return {
    json: () => Promise.resolve(body),
    headers: new Headers({
      authorization: 'Bearer token',
      host: requestUrl.host,
      'idempotency-key': IDEMPOTENCY_KEY,
      ...headers,
    }),
    method: 'POST',
    nextUrl: requestUrl,
    url: requestUrl.toString(),
  } as unknown as NextRequest;
}

function createSupabaseMock(rows: ImeiLookupRow[] = []) {
  const updates: Array<{
    filters: Record<string, unknown>;
    payload: Record<string, unknown>;
  }> = [];
  const deletes: Array<{
    filters: Record<string, unknown>;
  }> = [];
  let insertedPayload: Record<string, unknown> | null = null;
  let insertError: { code?: string; message: string } | null = null;
  let concurrentWinner: ImeiLookupRow | null = null;
  let updateError: { code?: string; message: string } | null = null;

  const supabase = {
    __rows: rows,
    __deletes: deletes,
    __updates: updates,
    __setInsertError: (error: { code?: string; message: string } | null) => {
      insertError = error;
    },
    __setConcurrentWinner: (row: ImeiLookupRow) => {
      concurrentWinner = row;
    },
    __setUpdateError: (error: { code?: string; message: string } | null) => {
      updateError = error;
    },
    from: vi.fn((table: string) => {
      if (table !== 'imei_lookups') {
        throw new Error(`Unexpected table: ${table}`);
      }
      const filters: Record<string, unknown> = {};
      let activeUpdate: {
        filters: Record<string, unknown>;
        payload: Record<string, unknown>;
      } | null = null;
      let activeDelete: {
        filters: Record<string, unknown>;
      } | null = null;
      const builder = {
        eq: vi.fn((column: string, value: unknown) => {
          filters[column] = value;
          if (activeUpdate) {
            activeUpdate.filters[column] = value;
          }
          if (activeDelete) {
            activeDelete.filters[column] = value;
          }
          return builder;
        }),
        delete: vi.fn(() => {
          activeDelete = { filters: { ...filters } };
          deletes.push(activeDelete);
          return builder;
        }),
        insert: vi.fn((payload: Record<string, unknown>) => {
          insertedPayload = payload;
          if (insertError && concurrentWinner) {
            rows.push(concurrentWinner);
            concurrentWinner = null;
          }
          return builder;
        }),
        maybeSingle: vi.fn(() => {
          const row =
            rows.find((candidate) =>
              Object.entries(filters).every(
                ([column, value]) =>
                  candidate[column as keyof ImeiLookupRow] === value
              )
            ) ?? null;
          return { data: row, error: null };
        }),
        select: vi.fn(() => builder),
        single: vi.fn(() => {
          if (activeUpdate) {
            const update = activeUpdate;
            if (updateError) {
              return { data: null, error: updateError };
            }
            const matchingRow = rows.find((candidate) =>
              Object.entries(update.filters).every(
                ([column, value]) =>
                  candidate[column as keyof ImeiLookupRow] === value
              )
            );
            if (!matchingRow) {
              return {
                data: null,
                error: {
                  message:
                    'JSON object requested, multiple (or no) rows returned',
                },
              };
            }
            return { data: { id: matchingRow.id }, error: null };
          }
          if (activeDelete) {
            const deleteRequest = activeDelete;
            const matchingIndex = rows.findIndex((candidate) =>
              Object.entries(deleteRequest.filters).every(
                ([column, value]) =>
                  candidate[column as keyof ImeiLookupRow] === value
              )
            );
            if (matchingIndex === -1) {
              return {
                data: null,
                error: {
                  message:
                    'JSON object requested, multiple (or no) rows returned',
                },
              };
            }
            const [deletedRow] = rows.splice(matchingIndex, 1);
            return { data: { id: deletedRow.id }, error: null };
          }
          if (insertError) {
            return { data: null, error: insertError };
          }
          const id = 'lookup-1';
          rows.push({
            amount_ngn: Number(insertedPayload?.amount_ngn ?? 0),
            cached_response: null,
            cached_status: null,
            customer_id: String(insertedPayload?.customer_id),
            device_category:
              (insertedPayload?.device_category as string | null) ?? null,
            id,
            idempotency_key: String(insertedPayload?.idempotency_key),
            imei_hash: String(insertedPayload?.imei_hash),
            merchant_id: String(insertedPayload?.merchant_id),
            status: String(insertedPayload?.status),
            tier: String(insertedPayload?.tier),
          });
          return { data: { id }, error: null };
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          activeUpdate = { filters: { ...filters }, payload };
          updates.push(activeUpdate);
          return builder;
        }),
      };
      return builder;
    }),
  };

  return supabase;
}

function mockAuthenticatedUser({
  adminSupabase = createSupabaseMock(),
  userSupabase = createSupabaseMock(),
}: {
  adminSupabase?: ReturnType<typeof createSupabaseMock>;
  userSupabase?: ReturnType<typeof createSupabaseMock>;
} = {}) {
  mocks.mockAuthenticateApiRequest.mockResolvedValue({
    error: null,
    supabase: userSupabase,
    user: { email: 'buyer@example.com', id: 'user-1' },
  });
  mocks.mockCreateAdminClient.mockReset();
  mocks.mockCreateAdminClient.mockReturnValue(adminSupabase);
  return { adminSupabase, userSupabase };
}

let routeModulePromise: Promise<typeof import('./route')> | null = null;

function importRoute() {
  routeModulePromise ??= import('./route');
  return routeModulePromise;
}

describe('POST /api/storefront/imei-check', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('IMEI_HASH_SALT', 'test-imei-salt');
    vi.stubEnv('SICKW_API_KEY', 'test-sickw-key');
    vi.stubEnv('PETROCK_ENABLED', 'false');
    vi.stubEnv('PETROCK_ENABLED_TIERS', '');
    delete process.env.PETROCK_API_TOKEN;
    delete process.env.IMEI_IDENTIFIER_ENCRYPTION_KEY;

    mocks.mockAuthenticateApiRequest.mockReset();
    mockAuthenticatedUser();
    mocks.mockCheckCsrfProtection.mockReset();
    mocks.mockCheckCsrfProtection.mockResolvedValue({ valid: true });
    mocks.mockCheckRateLimit.mockReset();
    mocks.mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      resetTime: Date.now() + 60_000,
    });
    mocks.mockResolveStorefrontMerchantFromRequest.mockReset();
    mocks.mockResolveStorefrontMerchantFromRequest.mockResolvedValue({
      identifier: 'ogabassey',
      merchant: { id: 'merchant-1', slug: 'ogabassey' },
      success: true,
    });
    mocks.mockResolveImeiCustomer.mockReset();
    mocks.mockResolveImeiCustomer.mockResolvedValue({
      email: 'buyer@example.com',
      first_name: 'Buyer',
      id: 'customer-1',
      last_name: null,
      phone: null,
      user_id: 'user-1',
    });
    mocks.mockReadCustomerWalletBalance.mockReset();
    mocks.mockReadCustomerWalletBalance.mockResolvedValue(5000);
    mocks.mockRedeemImeiWalletPayment.mockReset();
    mocks.mockRedeemImeiWalletPayment.mockResolvedValue(undefined);
    mocks.mockRedeemPetrockWalletAndBeginSubmission.mockReset();
    mocks.mockRedeemPetrockWalletAndBeginSubmission.mockResolvedValue(
      undefined
    );
    mocks.mockReadPetrockProductSnapshot.mockReset();
    mocks.mockReadPetrockProductSnapshot.mockResolvedValue({
      active: true,
      currency: 'USD',
      order_field_name: 'IMEI',
      price_usd: 0.06,
      product_id: '716',
      synced_at: new Date().toISOString(),
    });
    mocks.mockPetrockSubmitOrder.mockReset();
    mocks.mockPetrockSubmitOrder.mockResolvedValue({
      data: { orderUuid: 'order-1', referenceId: 'reference-1' },
      ok: true,
      rawText: '{}',
    });
    mocks.mockPetrockGetOrder.mockReset();
    mocks.mockRecordPetrockSubmission.mockReset();
    mocks.mockRecordPetrockSubmission.mockResolvedValue(true);
    mocks.mockMarkPetrockSubmissionUnknown.mockReset();
    mocks.mockMarkPetrockSubmissionUnknown.mockResolvedValue(true);
    mocks.mockFinalizePetrockLookup.mockReset();
    mocks.mockFinalizePetrockLookup.mockResolvedValue(true);
    mocks.mockRefundImeiWalletPayment.mockReset();
    mocks.mockRefundImeiWalletPayment.mockResolvedValue(undefined);
    mocks.mockRequestSickwCheck.mockReset();
    mocks.mockRequestSickwCheck.mockResolvedValue({
      body: {
        data: { device: 'iPhone 15', imei: VALID_IMEI },
        success: true,
        tier: { checksIncluded: ['device'], name: 'Full Check' },
      },
      ok: true,
      rawResponseText: '{"result":"Model Name: iPhone 15"}',
      sickwStatus: 'success',
      status: 200,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 with AUTH_REQUIRED when no session is present', async () => {
    mocks.mockAuthenticateApiRequest.mockResolvedValueOnce({
      error: 'Not authenticated',
      supabase: null,
      user: null,
    });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(401);
    expect(body.code).toBe('AUTH_REQUIRED');
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
  }, 60_000);

  it('authenticates before returning 429 and skips storefront resolution', async () => {
    mocks.mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 10,
      remaining: 0,
      resetTime: Date.now() + 60_000,
    });
    const { POST } = await importRoute();

    const response = await POST(createRequest());

    expect(response.status).toBe(429);
    expect(mocks.mockAuthenticateApiRequest).toHaveBeenCalledOnce();
    expect(
      mocks.mockResolveStorefrontMerchantFromRequest
    ).not.toHaveBeenCalled();
  });

  it('returns 403 when CSRF token validation fails', async () => {
    mocks.mockCheckCsrfProtection.mockResolvedValueOnce({
      response: Response.json({ error: 'Invalid CSRF token' }, { status: 403 }),
      valid: false,
    });
    const { POST } = await importRoute();

    const response = await POST(createRequest());

    expect(response.status).toBe(403);
    expect(
      mocks.mockResolveStorefrontMerchantFromRequest
    ).not.toHaveBeenCalled();
  });

  it('uses the submitted merchant slug on a root-host path storefront', async () => {
    const { POST } = await importRoute();

    const response = await POST(
      createRequest(
        {
          imei: VALID_IMEI,
          merchantSlug: 'ogabassey',
          tier: 'full',
        },
        {},
        'https://usebaci.com/api/storefront/imei-check'
      )
    );

    expect(response.status).toBe(200);
    expect(mocks.mockResolveStorefrontMerchantFromRequest).toHaveBeenCalledWith(
      expect.objectContaining({ fallbackIdentifier: 'ogabassey' })
    );
  });

  it('returns 400 when Idempotency-Key is missing or malformed', async () => {
    const { POST } = await importRoute();

    const missingResponse = await POST(
      createRequest(undefined, { 'idempotency-key': '' })
    );
    const malformedResponse = await POST(
      createRequest(undefined, { 'idempotency-key': 'not-a-uuid' })
    );
    const body = (await missingResponse.json()) as { code: string };

    expect(missingResponse.status).toBe(400);
    expect(malformedResponse.status).toBe(400);
    expect(body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
    expect(mocks.mockResolveImeiCustomer).not.toHaveBeenCalled();
  });

  it('rejects unknown service tiers before customer resolution or persistence', async () => {
    // The full catalog is now public (device-category expansion), so the tier
    // gate only rejects keys that are not real service tiers at all.
    const { POST } = await importRoute();

    const response = await POST(
      createRequest({ imei: VALID_IMEI, tier: 'not-a-real-tier' })
    );
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_REQUEST_BODY');
    expect(mocks.mockResolveImeiCustomer).not.toHaveBeenCalled();
    expect(mocks.mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
  });

  it('rejects an over-length serial before any wallet debit or provider call', async () => {
    // Regression: a 15-char alphanumeric passes the Zod schema, but a serial
    // tier only accepts 8-14 chars. Validation must reject the RAW value —
    // normalizing first would truncate it to 14 and bill a paid lookup.
    const { POST } = await importRoute();

    const response = await POST(
      createRequest({ imei: 'ABCDEFGH12345XY', tier: 'serialInfo' })
    );
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_IMEI');
    expect(mocks.mockResolveImeiCustomer).not.toHaveBeenCalled();
    expect(mocks.mockRedeemImeiWalletPayment).not.toHaveBeenCalled();
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
  });

  it('rejects an IMEI for a serial-only device tab before any wallet debit', async () => {
    const { POST } = await importRoute();

    const response = await POST(
      createRequest({
        device: 'laptop',
        imei: VALID_IMEI,
        tier: 'activation',
      })
    );
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(400);
    expect(body.code).toBe('INVALID_IMEI');
    expect(mocks.mockRedeemImeiWalletPayment).not.toHaveBeenCalled();
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
  });

  it('returns 404 when the authenticated user has no customer for the storefront', async () => {
    mocks.mockResolveImeiCustomer.mockResolvedValueOnce(null);
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(404);
    expect(body.code).toBe('CUSTOMER_NOT_FOUND');
    expect(mocks.mockRedeemImeiWalletPayment).not.toHaveBeenCalled();
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
  });

  it('returns 503 before new persistence when IMEI_HASH_SALT is missing', async () => {
    vi.stubEnv('IMEI_HASH_SALT', '');
    const adminSupabase = createSupabaseMock();
    mockAuthenticatedUser({ adminSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(503);
    expect(body.code).toBe('IMEI_HASH_SALT_MISSING');
    expect(adminSupabase.from).toHaveBeenCalledOnce();
    expect(mocks.mockRedeemImeiWalletPayment).not.toHaveBeenCalled();
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
  });

  it('replays a cached terminal response even when IMEI_HASH_SALT is missing', async () => {
    vi.stubEnv('IMEI_HASH_SALT', '');
    const cachedBody = {
      data: { device: 'iPhone 15', imei: VALID_IMEI },
      success: true,
      tier: { checksIncluded: ['device'], name: 'Full Check' },
    };
    mockAuthenticatedUser({
      adminSupabase: createSupabaseMock([
        {
          amount_ngn: 1500,
          cached_response: cachedBody,
          cached_status: 200,
          customer_id: 'customer-1',
          id: 'lookup-1',
          idempotency_key: IDEMPOTENCY_KEY,
          imei_hash: 'persisted-hash',
          merchant_id: 'merchant-1',
          status: 'completed',
          tier: 'full',
        },
      ]),
    });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ...cachedBody, lookupId: 'lookup-1' });
    expect(mocks.mockRedeemImeiWalletPayment).not.toHaveBeenCalled();
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
  });

  it('replays a cached terminal response even when SICKW_API_KEY is missing', async () => {
    vi.stubEnv('SICKW_API_KEY', '');
    const cachedBody = {
      code: 'WALLET_INSUFFICIENT',
      error: 'Insufficient wallet balance',
      required: 1500,
      success: false,
    };
    mockAuthenticatedUser({
      adminSupabase: createSupabaseMock([
        {
          amount_ngn: 1500,
          cached_response: cachedBody,
          cached_status: 402,
          customer_id: 'customer-1',
          id: 'lookup-1',
          idempotency_key: IDEMPOTENCY_KEY,
          imei_hash: hashImeiForTest(VALID_IMEI),
          merchant_id: 'merchant-1',
          status: 'wallet_rejected',
          tier: 'full',
        },
      ]),
    });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = await response.json();

    expect(response.status).toBe(402);
    expect(body).toEqual({ ...cachedBody, lookupId: 'lookup-1' });
    expect(mocks.mockRedeemImeiWalletPayment).not.toHaveBeenCalled();
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
  });

  it('returns 503 before new persistence when SICKW_API_KEY is missing', async () => {
    vi.stubEnv('SICKW_API_KEY', '');
    const adminSupabase = createSupabaseMock();
    mockAuthenticatedUser({ adminSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(503);
    expect(body.code).toBe('SICKW_API_KEY_MISSING');
    expect(adminSupabase.from).toHaveBeenCalledOnce();
    expect(mocks.mockCreateAdminClient).toHaveBeenCalled();
    expect(mocks.mockRedeemImeiWalletPayment).not.toHaveBeenCalled();
  });

  it('keeps an allowlisted migrated tier on Sickw for legacy clients', async () => {
    vi.stubEnv('PETROCK_ENABLED', 'true');
    vi.stubEnv('PETROCK_ENABLED_TIERS', 'blacklist');
    vi.stubEnv('PETROCK_API_TOKEN', 'petrock-token');
    vi.stubEnv(
      'IMEI_IDENTIFIER_ENCRYPTION_KEY',
      Buffer.alloc(32, 7).toString('base64')
    );
    const { POST } = await importRoute();

    const response = await POST(
      createRequest({
        device: 'smartphone',
        imei: VALID_IMEI,
        tier: 'blacklist',
      })
    );

    expect(response.status).toBe(200);
    expect(mocks.mockRequestSickwCheck).toHaveBeenCalled();
    expect(
      mocks.mockRedeemPetrockWalletAndBeginSubmission
    ).not.toHaveBeenCalled();
  });

  it('returns 202 after an async-capable Petrock order is accepted', async () => {
    vi.stubEnv('PETROCK_ENABLED', 'true');
    vi.stubEnv('PETROCK_ENABLED_TIERS', 'simLock');
    vi.stubEnv('PETROCK_API_TOKEN', 'petrock-token');
    vi.stubEnv(
      'IMEI_IDENTIFIER_ENCRYPTION_KEY',
      Buffer.alloc(32, 7).toString('base64')
    );
    const { POST } = await importRoute();

    const response = await POST(
      createRequest({
        clientCapabilities: ['imei-async-v1'],
        device: 'smartphone',
        imei: VALID_IMEI,
        tier: 'simLock',
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      lookupId: 'lookup-1',
      status: 'pending',
      success: true,
    });
    expect(mocks.mockRedeemPetrockWalletAndBeginSubmission).toHaveBeenCalled();
    expect(mocks.mockRecordPetrockSubmission).toHaveBeenCalled();
    expect(mocks.mockRedeemImeiWalletPayment).not.toHaveBeenCalled();
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
  });

  it('fails Petrock preflight before debit when the catalog is stale', async () => {
    vi.stubEnv('PETROCK_ENABLED', 'true');
    vi.stubEnv('PETROCK_ENABLED_TIERS', 'simLock');
    vi.stubEnv('PETROCK_API_TOKEN', 'petrock-token');
    vi.stubEnv(
      'IMEI_IDENTIFIER_ENCRYPTION_KEY',
      Buffer.alloc(32, 7).toString('base64')
    );
    mocks.mockReadPetrockProductSnapshot.mockResolvedValueOnce({
      active: true,
      currency: 'USD',
      order_field_name: 'IMEI',
      price_usd: 0.06,
      product_id: '716',
      synced_at: '2026-01-01T00:00:00.000Z',
    });
    const { POST } = await importRoute();

    const response = await POST(
      createRequest({
        clientCapabilities: ['imei-async-v1'],
        device: 'smartphone',
        imei: VALID_IMEI,
        tier: 'simLock',
      })
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'PROVIDER_PRICE_STALE',
    });
    expect(
      mocks.mockRedeemPetrockWalletAndBeginSubmission
    ).not.toHaveBeenCalled();
  });

  it('keeps a Petrock POST timeout pending without refunding', async () => {
    vi.stubEnv('PETROCK_ENABLED', 'true');
    vi.stubEnv('PETROCK_ENABLED_TIERS', 'simLock');
    vi.stubEnv('PETROCK_API_TOKEN', 'petrock-token');
    vi.stubEnv(
      'IMEI_IDENTIFIER_ENCRYPTION_KEY',
      Buffer.alloc(32, 7).toString('base64')
    );
    mocks.mockPetrockSubmitOrder.mockResolvedValueOnce({
      kind: 'timeout',
      message: 'Petrock request timed out',
      ok: false,
    });
    const { POST } = await importRoute();

    const response = await POST(
      createRequest({
        clientCapabilities: ['imei-async-v1'],
        device: 'smartphone',
        imei: VALID_IMEI,
        tier: 'simLock',
      })
    );

    expect(response.status).toBe(202);
    expect(mocks.mockMarkPetrockSubmissionUnknown).toHaveBeenCalled();
    expect(mocks.mockRefundImeiWalletPayment).not.toHaveBeenCalled();
  });

  it('replays a pending Petrock lookup without placing another order', async () => {
    const adminSupabase = createSupabaseMock([
      {
        amount_ngn: 700,
        cached_response: null,
        cached_status: null,
        customer_id: 'customer-1',
        device_category: 'smartphone',
        id: 'lookup-existing',
        idempotency_key: IDEMPOTENCY_KEY,
        imei_hash: hashImeiForTest(VALID_IMEI),
        merchant_id: 'merchant-1',
        status: 'pending_provider',
        tier: 'blacklist',
      },
    ]);
    mockAuthenticatedUser({ adminSupabase });
    const { POST } = await importRoute();

    const response = await POST(
      createRequest({
        clientCapabilities: ['imei-async-v1'],
        device: 'smartphone',
        imei: VALID_IMEI,
        tier: 'blacklist',
      })
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      lookupId: 'lookup-existing',
    });
    expect(mocks.mockPetrockSubmitOrder).not.toHaveBeenCalled();
  });

  it('returns 402 and caches the terminal response when wallet balance is short', async () => {
    const insufficient = Object.assign(
      new Error('insufficient_wallet_balance'),
      {
        code: 'P0001',
      }
    );
    mocks.mockReadCustomerWalletBalance
      .mockResolvedValueOnce(800)
      .mockResolvedValueOnce(500);
    mocks.mockRedeemImeiWalletPayment.mockRejectedValueOnce(insufficient);
    const adminSupabase = createSupabaseMock();
    const userSupabase = createSupabaseMock();
    mockAuthenticatedUser({ adminSupabase, userSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as {
      balance: number;
      code: string;
      required: number;
    };

    expect(response.status).toBe(402);
    expect(body).toMatchObject({
      balance: 500,
      code: 'WALLET_INSUFFICIENT',
      required: 1500,
    });
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
    expect(adminSupabase.__deletes.at(-1)).toMatchObject({
      filters: { id: 'lookup-1' },
    });
    expect(adminSupabase.__updates).toHaveLength(0);
  });

  it('continues the paid lookup when the preflight wallet balance read fails', async () => {
    mocks.mockReadCustomerWalletBalance.mockRejectedValueOnce(
      new Error('balance read unavailable')
    );
    const adminSupabase = createSupabaseMock();
    const userSupabase = createSupabaseMock();
    mockAuthenticatedUser({ adminSupabase, userSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { data: { device: string } };

    expect(response.status).toBe(200);
    expect(body.data.device).toBe('iPhone 15');
    expect(mocks.mockReadCustomerWalletBalance).toHaveBeenCalledOnce();
    expect(mocks.mockRedeemImeiWalletPayment).toHaveBeenCalledWith(
      expect.objectContaining({ supabaseAdmin: adminSupabase })
    );
    expect(mocks.mockRequestSickwCheck).toHaveBeenCalled();
    expect(adminSupabase.__updates.at(-1)).toMatchObject({
      filters: { id: 'lookup-1' },
      payload: {
        cached_status: 200,
        status: 'completed',
      },
    });
  });

  it('caches a terminal 500 when wallet debit fails unexpectedly', async () => {
    mocks.mockRedeemImeiWalletPayment.mockRejectedValueOnce(
      new Error('wallet rpc unavailable')
    );
    const adminSupabase = createSupabaseMock();
    mockAuthenticatedUser({ adminSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
    expect(adminSupabase.__updates.at(-1)).toMatchObject({
      filters: { id: 'lookup-1' },
      payload: {
        cached_response: body,
        cached_status: 500,
        sickw_status: 'wallet_debit_error',
        status: 'failed_error',
      },
    });
  });

  it('removes the uncharged pending lookup when debit failure caching fails', async () => {
    mocks.mockRedeemImeiWalletPayment.mockRejectedValueOnce(
      new Error('wallet rpc unavailable')
    );
    const adminSupabase = createSupabaseMock();
    adminSupabase.__setUpdateError({ message: 'database unavailable' });
    mockAuthenticatedUser({ adminSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(500);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(adminSupabase.__deletes.at(-1)).toMatchObject({
      filters: { id: 'lookup-1' },
    });
    expect(adminSupabase.__rows).toHaveLength(0);
  });

  it('debits the wallet before calling SICKW', async () => {
    const callOrder: string[] = [];
    mocks.mockRedeemImeiWalletPayment.mockImplementationOnce(() => {
      callOrder.push('debit');
    });
    mocks.mockRequestSickwCheck.mockImplementationOnce(() => {
      callOrder.push('sickw');
      return {
        body: {
          data: { device: 'iPhone 15', imei: VALID_IMEI },
          success: true,
          tier: { checksIncluded: ['device'], name: 'Full Check' },
        },
        ok: true,
        rawResponseText: 'raw-provider-payload',
        sickwStatus: 'success',
        status: 200,
      };
    });
    const adminSupabase = createSupabaseMock();
    const userSupabase = createSupabaseMock();
    mockAuthenticatedUser({ adminSupabase, userSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());

    expect(response.status).toBe(200);
    expect(callOrder).toEqual(['debit', 'sickw']);
    // H4: imei_lookups writes + wallet RPCs go through the service-role
    // client. Reads (resolveImeiCustomer / wallet balance) stay on the
    // authenticated user client.
    expect(mocks.mockCreateAdminClient).toHaveBeenCalled();
    expect(mocks.mockResolveImeiCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: userSupabase })
    );
    expect(mocks.mockReadCustomerWalletBalance).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: userSupabase })
    );
    expect(mocks.mockRedeemImeiWalletPayment).toHaveBeenCalledWith(
      expect.objectContaining({ supabaseAdmin: adminSupabase })
    );
    expect(userSupabase.__updates).toHaveLength(0);
    expect(adminSupabase.__updates.at(-1)).toMatchObject({
      filters: { id: 'lookup-1' },
      payload: {
        response_hash: createHash('sha256')
          .update('raw-provider-payload')
          .digest('hex'),
        status: 'completed',
      },
    });
  });

  it('returns the paid lookup result when successful lookup persistence fails', async () => {
    const adminSupabase = createSupabaseMock();
    adminSupabase.__setUpdateError({ message: 'database unavailable' });
    mockAuthenticatedUser({ adminSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { data: { device: string } };

    expect(response.status).toBe(200);
    expect(body.data.device).toBe('iPhone 15');
    expect(mocks.mockRefundImeiWalletPayment).not.toHaveBeenCalled();
    expect(adminSupabase.__updates.at(-1)).toMatchObject({
      filters: { id: 'lookup-1' },
      payload: {
        cached_status: 200,
        status: 'completed',
      },
    });
  });

  it('refunds and caches a 502 when SICKW fails', async () => {
    mocks.mockRequestSickwCheck.mockResolvedValueOnce({
      body: {
        code: 'SICKW_UNAVAILABLE',
        error: 'Lookup failed; your wallet was refunded.',
        success: false,
      },
      ok: false,
      refundReason: 'error',
      sickwStatus: 'unavailable',
      status: 502,
    });
    const adminSupabase = createSupabaseMock();
    mockAuthenticatedUser({ adminSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(502);
    expect(body.code).toBe('SICKW_UNAVAILABLE');
    expect(mocks.mockRefundImeiWalletPayment).toHaveBeenCalledWith(
      expect.objectContaining({ lookupId: 'lookup-1' })
    );
    expect(adminSupabase.__updates.at(-1)).toMatchObject({
      filters: { id: 'lookup-1' },
      payload: {
        cached_status: 502,
        status: 'refunded_error',
      },
    });
  });

  it('returns the refunded terminal response when refunded state cannot be persisted', async () => {
    mocks.mockRequestSickwCheck.mockResolvedValueOnce({
      body: {
        code: 'SICKW_UNAVAILABLE',
        error: 'Lookup failed; your wallet was refunded.',
        success: false,
      },
      ok: false,
      refundReason: 'error',
      sickwStatus: 'unavailable',
      status: 502,
    });
    const adminSupabase = createSupabaseMock();
    adminSupabase.__setUpdateError({ message: 'database unavailable' });
    mockAuthenticatedUser({ adminSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(502);
    expect(body.code).toBe('SICKW_UNAVAILABLE');
    expect(mocks.mockRefundImeiWalletPayment).toHaveBeenCalledWith(
      expect.objectContaining({ lookupId: 'lookup-1' })
    );
    expect(adminSupabase.__updates).toHaveLength(2);
    expect(adminSupabase.__updates.at(-1)).toMatchObject({
      filters: { id: 'lookup-1' },
      payload: {
        cached_status: 502,
        status: 'refunded_error',
      },
    });
  });

  it('marks refund_pending when refund RPC fails', async () => {
    mocks.mockRequestSickwCheck.mockResolvedValueOnce({
      body: {
        code: 'SICKW_NOT_FOUND',
        error: 'IMEI result was not found; your wallet was refunded.',
        success: false,
      },
      ok: false,
      refundReason: 'not_found',
      sickwStatus: 'not_found',
      status: 404,
    });
    mocks.mockRefundImeiWalletPayment.mockRejectedValueOnce(
      new Error('refund rpc down')
    );
    const adminSupabase = createSupabaseMock();
    mockAuthenticatedUser({ adminSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(502);
    expect(body.code).toBe('REFUND_PENDING');
    expect(adminSupabase.__updates.at(-1)).toMatchObject({
      filters: { id: 'lookup-1' },
      payload: {
        cached_status: 502,
        status: 'refund_pending',
      },
    });
  });

  it('returns refund_pending when refund_pending state cannot be persisted', async () => {
    mocks.mockRequestSickwCheck.mockResolvedValueOnce({
      body: {
        code: 'SICKW_UNAVAILABLE',
        error: 'Lookup failed; your wallet was refunded.',
        success: false,
      },
      ok: false,
      refundReason: 'error',
      sickwStatus: 'unavailable',
      status: 502,
    });
    mocks.mockRefundImeiWalletPayment.mockRejectedValueOnce(
      new Error('refund rpc down')
    );
    const adminSupabase = createSupabaseMock();
    adminSupabase.__setUpdateError({ message: 'database unavailable' });
    mockAuthenticatedUser({ adminSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(502);
    expect(body.code).toBe('REFUND_PENDING');
    expect(adminSupabase.__updates).toHaveLength(2);
    expect(adminSupabase.__updates.at(-1)).toMatchObject({
      filters: { id: 'lookup-1' },
      payload: {
        cached_status: 502,
        status: 'refund_pending',
      },
    });
  });

  it('returns 409 on Idempotency-Key reuse with a different fingerprint', async () => {
    mockAuthenticatedUser({
      adminSupabase: createSupabaseMock([
        {
          amount_ngn: 1500,
          cached_response: null,
          cached_status: null,
          customer_id: 'customer-1',
          id: 'lookup-1',
          idempotency_key: IDEMPOTENCY_KEY,
          imei_hash: 'different-hash',
          merchant_id: 'merchant-1',
          status: 'completed',
          tier: 'full',
        },
      ]),
    });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(mocks.mockRedeemImeiWalletPayment).not.toHaveBeenCalled();
  });

  it('handles a concurrent insert race for the same Idempotency-Key', async () => {
    const adminSupabase = createSupabaseMock();
    adminSupabase.__setInsertError({
      code: '23505',
      message: 'duplicate key',
    });
    adminSupabase.__setConcurrentWinner({
      amount_ngn: 1500,
      cached_response: {
        data: { device: 'iPhone 15', imei: VALID_IMEI },
        success: true,
      },
      cached_status: 200,
      customer_id: 'customer-1',
      id: 'lookup-winner',
      idempotency_key: IDEMPOTENCY_KEY,
      imei_hash: hashImeiForTest(VALID_IMEI),
      merchant_id: 'merchant-1',
      status: 'completed',
      tier: 'full',
    });
    mockAuthenticatedUser({ adminSupabase });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { success: boolean };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mocks.mockRedeemImeiWalletPayment).not.toHaveBeenCalled();
  });

  it('returns 409 when a unique Idempotency-Key collision is hidden by RLS', async () => {
    const adminSupabase = createSupabaseMock();
    adminSupabase.__setInsertError({
      code: '23505',
      message: 'duplicate key',
    });
    mockAuthenticatedUser({
      adminSupabase,
      userSupabase: createSupabaseMock(),
    });
    const { POST } = await importRoute();

    const response = await POST(createRequest());
    const body = (await response.json()) as { code: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe('IDEMPOTENCY_CONFLICT');
    expect(mocks.mockRedeemImeiWalletPayment).not.toHaveBeenCalled();
    expect(mocks.mockRequestSickwCheck).not.toHaveBeenCalled();
  });
});

vi.mock('@/lib/imei-device-catalog', () => ({
  enrichImeiDeviceResult: vi.fn(
    async (_merchantId: string, result: unknown) => result
  ),
}));

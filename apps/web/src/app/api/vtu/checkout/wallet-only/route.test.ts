import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { computeVtuWalletRequestFingerprint } from '@/lib/vtu-wallet-fingerprint';

const {
  mockAuthenticate,
  mockCheckCsrf,
  mockPrepare,
  mockFulfill,
  mockResolveVtuCustomer,
  mockGetCurrentSlugForAliasStrict,
} = vi.hoisted(() => ({
  mockAuthenticate: vi.fn(),
  mockCheckCsrf: vi.fn(),
  mockPrepare: vi.fn(),
  mockFulfill: vi.fn(),
  mockResolveVtuCustomer: vi.fn(),
  mockGetCurrentSlugForAliasStrict: vi.fn(),
}));

vi.mock('@/lib/slug-alias-cache', () => ({
  getCurrentSlugForAlias: vi.fn().mockResolvedValue(null),
  getCurrentSlugForAliasStrict: mockGetCurrentSlugForAliasStrict,
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: mockAuthenticate,
}));

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: mockCheckCsrf,
}));

vi.mock('@/lib/vtu-pending-transaction', () => ({
  preparePendingVtuTransaction: mockPrepare,
  resolveVtuCustomer: mockResolveVtuCustomer,
  VTU_TYPE_LABELS: { airtime: 'Airtime' },
}));

vi.mock('@/lib/vtu-fulfillment', () => ({
  fulfillPendingVtuTransaction: mockFulfill,
}));

interface MockSupabase {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
}

const supabaseMockRef: { current: MockSupabase | null } = { current: null };

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => supabaseMockRef.current,
}));

// Import the route AFTER all mocks are registered. Using a factory call
// inside `beforeEach` (instead of a top-level import) lets each test
// rebuild the supabase mock and have the route handler pick it up.
async function callRoute(
  request: NextRequest
): Promise<{ status: number; body: unknown }> {
  const { POST } = await import('./route');
  const response = await POST(request);
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

interface IdempotencyRowState {
  row: {
    key: string;
    vtu_transaction_id: string;
    customer_id: string;
    merchant_id: string;
    request_fingerprint: string;
  } | null;
  insertCalls: number;
  rpcCalls?: Array<{ fn: string; args: Record<string, unknown> }>;
}

function buildSupabase(
  state: IdempotencyRowState,
  options?: { requestingCustomerId?: string }
): MockSupabase {
  // The route resolves the requesting customer before validating
  // ownership of an existing idempotency row. Default the lookup to the
  // user's "customer-1" id so happy/replay paths pass; tests that
  // exercise the cross-customer collision pass a different value here.
  const requestingCustomerId = options?.requestingCustomerId ?? 'customer-1';
  return {
    from: vi.fn((table: string) => {
      if (table === 'vtu_idempotency_keys') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: state.row, error: null }),
            })),
          })),
          insert: vi.fn((row: typeof state.row) => {
            state.insertCalls += 1;
            state.row = row;
            return Promise.resolve({ data: null, error: null });
          }),
        };
      }
      if (table === 'merchants') {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'merchant-1' },
                error: null,
              }),
            })),
          })),
        };
      }
      if (table === 'customers') {
        // Mirrors `resolveVtuCustomer`'s shape:
        //   .from('customers').select(...).eq(merchant_id).eq(user_id).maybeSingle()
        //   (and a fallback by email; the route doesn't exercise that
        //   path under the default test config because the user_id
        //   lookup already returns a row).
        const byUserIdMaybeSingle = vi.fn().mockResolvedValue({
          data: { id: requestingCustomerId, email: 'c@example.com' },
          error: null,
        });
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: byUserIdMaybeSingle,
              })),
            })),
          })),
        };
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn().mockResolvedValue({ data: null, error: null }),
          })),
        })),
      };
    }),
    rpc: vi.fn((fn: string, args: Record<string, unknown>) => {
      state.rpcCalls?.push({ fn, args });
      return Promise.resolve({ data: null, error: null });
    }),
  };
}

const VALID_BODY = {
  merchantSlug: 'ogabassey',
  type: 'airtime',
  amount: 1000,
  walletAmount: 1000,
  phoneNumber: '08012345678',
  networkProvider: 'MTN',
};

// The route injects `source: 'checkout'` before parsing; the schema
// then validates and produces this shape. The route does NOT include
// `merchantSlug` or `source` in the fingerprint (only recipient/intent
// fields), so any value of those works for hashing.
const VALID_BODY_FINGERPRINT = computeVtuWalletRequestFingerprint({
  ...VALID_BODY,
  source: 'checkout',
} as Parameters<typeof computeVtuWalletRequestFingerprint>[0]);

const VALID_KEY = '11111111-2222-3333-4444-555555555555';

function makeRequest({
  body = VALID_BODY,
  idempotencyKey,
}: {
  body?: unknown;
  idempotencyKey?: string;
}) {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }
  return new NextRequest('http://localhost/api/vtu/checkout/wallet-only', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('POST /api/vtu/checkout/wallet-only', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticate.mockResolvedValue({
      user: { id: 'user-1', email: 'c@example.com' },
      error: null,
    });
    mockCheckCsrf.mockResolvedValue({ valid: true });
    mockPrepare.mockResolvedValue({
      customer: { id: 'customer-1' },
      merchant: { id: 'merchant-1', slug: 'ogabassey' },
      transaction: {
        id: 'vtu-tx-new',
        type: 'airtime',
        request_reference: 'VTU-REF-NEW',
      },
      requestReference: 'VTU-REF-NEW',
    });
    mockFulfill.mockResolvedValue({
      amount: 1000,
      loyaltyPoints: {
        credited: true,
        earned: 5,
        newBalance: 205,
      },
      reference: 'VTU-REF-NEW',
      status: 'successful',
    });
    mockResolveVtuCustomer.mockResolvedValue({
      id: 'customer-1',
      email: 'c@example.com',
    });
    mockGetCurrentSlugForAliasStrict.mockReset();
    mockGetCurrentSlugForAliasStrict.mockResolvedValue(null);
    supabaseMockRef.current = buildSupabase({ row: null, insertCalls: 0 });
  });

  it('rejects when Idempotency-Key header is missing', async () => {
    const { status, body } = await callRoute(makeRequest({}));
    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: expect.stringMatching(/idempotency/i),
    });
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON body with a 400 (not a generic 500)', async () => {
    // Using `new NextRequest` directly so we can pass a non-JSON
    // body string. The route's outer try/catch would otherwise map
    // the SyntaxError to a generic 500, leaking nothing useful to
    // the client.
    const request = new NextRequest(
      'http://localhost/api/vtu/checkout/wallet-only',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'Idempotency-Key': VALID_KEY,
        },
        body: 'not-json{',
      }
    );
    const { POST } = await import('./route');
    const response = await POST(request);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({ error: expect.stringMatching(/json/i) });
  });

  it('rejects when Idempotency-Key is not a UUID', async () => {
    const { status } = await callRoute(
      makeRequest({ idempotencyKey: 'not-a-uuid' })
    );
    expect(status).toBe(400);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('rejects when walletAmount !== amount (use the regular initialize route)', async () => {
    const { status, body } = await callRoute(
      makeRequest({
        idempotencyKey: VALID_KEY,
        body: { ...VALID_BODY, walletAmount: 500 },
      })
    );
    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: expect.stringMatching(/wallet-only/i),
    });
  });

  it('rejects a session mismatch before any database operation (403, key kept)', async () => {
    // Web client captured user-A but the ambient cookie is now
    // someone else: fail closed before the idempotency lookup, let
    // alone the debit — otherwise the POST debits the new account
    // for the old payload.
    const state: IdempotencyRowState = { row: null, insertCalls: 0 };
    supabaseMockRef.current = buildSupabase(state);

    const { status, body } = await callRoute(
      makeRequest({
        idempotencyKey: VALID_KEY,
        body: {
          ...VALID_BODY,
          expectedUserId: '22222222-2222-4222-8222-222222222222',
        },
      })
    );

    expect(status).toBe(403);
    expect(body).toMatchObject({
      error: 'Account changed during checkout. Please try again.',
    });
    expect(state.insertCalls).toBe(0);
    expect(
      (supabaseMockRef.current?.from as ReturnType<typeof vi.fn>).mock.calls
    ).toHaveLength(0);
    expect(mockPrepare).not.toHaveBeenCalled();
  });

  it('proceeds when the captured user matches the session', async () => {
    const SUBMITTER = '33333333-3333-4333-8333-333333333333';
    mockAuthenticate.mockResolvedValue({
      user: { id: SUBMITTER, email: 'c@example.com' },
      error: null,
    });

    const { status } = await callRoute(
      makeRequest({
        idempotencyKey: VALID_KEY,
        body: { ...VALID_BODY, expectedUserId: SUBMITTER },
      })
    );

    expect(status).toBe(200);
    expect(mockPrepare).toHaveBeenCalled();
  });

  it('happy path: prepares the row, fulfills, returns success — no transactions table write', async () => {
    const state: IdempotencyRowState = { row: null, insertCalls: 0 };
    supabaseMockRef.current = buildSupabase(state);

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: 'successful',
      reference: 'VTU-REF-NEW',
      loyaltyPoints: {
        credited: true,
        earned: 5,
        newBalance: 205,
      },
    });
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(mockFulfill).toHaveBeenCalledWith({
      supabase: expect.anything(),
      transactionId: 'vtu-tx-new',
    });
    expect(state.insertCalls).toBe(1);
    // No `from('transactions')` write.
    const fromCalls = (
      supabaseMockRef.current?.from as ReturnType<typeof vi.fn>
    ).mock.calls;
    expect(fromCalls.some((c) => c[0] === 'transactions')).toBe(false);
  });

  it('returns stale data bundle errors as client-refresh 400s without error logging', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockPrepare.mockRejectedValueOnce(
      new Error(
        'Data bundle not found for MTN at ₦3,500. Please refresh data bundles and select a package.'
      )
    );

    const { status, body } = await callRoute(
      makeRequest({
        body: {
          ...VALID_BODY,
          amount: 3500,
          walletAmount: 3500,
          type: 'data',
          dataPlanCode: 'MTN-35GB-MONTHLY',
        },
        idempotencyKey: VALID_KEY,
      })
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({
      error:
        'Data bundle not found for MTN at ₦3,500. Please refresh data bundles and select a package.',
    });
    expect(mockFulfill).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('returns deterministic Monnify amount failures as actionable 400s without error logging', async () => {
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    mockPrepare.mockRejectedValueOnce(
      new Error('Amount for DSTV Compact must be exactly 12500')
    );

    const { status, body } = await callRoute(
      makeRequest({
        body: { ...VALID_BODY, amount: 1000, walletAmount: 1000 },
        idempotencyKey: VALID_KEY,
      })
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: 'Amount for DSTV Compact must be exactly 12500',
    });
    expect(mockFulfill).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('idempotent replay: same Idempotency-Key returns the cached fulfillment, no new prepare', async () => {
    const state: IdempotencyRowState = {
      row: {
        key: VALID_KEY,
        vtu_transaction_id: 'vtu-tx-existing',
        customer_id: 'customer-1',
        merchant_id: 'merchant-1',
        request_fingerprint: VALID_BODY_FINGERPRINT,
      },
      insertCalls: 0,
    };
    supabaseMockRef.current = buildSupabase(state);
    mockFulfill.mockResolvedValue({
      amount: 1000,
      loyaltyPoints: {
        credited: true,
        earned: 5,
        newBalance: 205,
      },
      reference: 'VTU-REF-OLD',
      status: 'successful',
    });

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      loyaltyPoints: {
        credited: true,
        earned: 5,
        newBalance: 205,
      },
    });
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockFulfill).toHaveBeenCalledWith({
      supabase: expect.anything(),
      transactionId: 'vtu-tx-existing',
    });
    expect(state.insertCalls).toBe(0);
  });

  it('idempotent replay: overlays the current-attempt phone and reference before re-driving', async () => {
    // Attempt 1 stored no phone (profile not yet hydrated) and its
    // validation reference has since expired; the retry carries
    // fresh values for both. Both sit outside the fingerprint, so the
    // replay proceeds — and the overlay must persist them (one atomic
    // RPC, no read-modify-write) before fulfillment re-drives the
    // Monnify/Kuda bill call.
    const state: IdempotencyRowState = {
      row: {
        key: VALID_KEY,
        vtu_transaction_id: 'vtu-tx-existing',
        customer_id: 'customer-1',
        merchant_id: 'merchant-1',
        request_fingerprint: VALID_BODY_FINGERPRINT,
      },
      insertCalls: 0,
      rpcCalls: [],
    };
    supabaseMockRef.current = buildSupabase(state);
    mockFulfill.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-REF-OLD',
      status: 'successful',
    });

    const { status } = await callRoute(
      makeRequest({
        idempotencyKey: VALID_KEY,
        body: {
          ...VALID_BODY,
          customerPhone: '08012345678',
          validationReference: 'VRF-9',
        },
      })
    );

    expect(status).toBe(200);
    expect(state.rpcCalls).toEqual([
      {
        fn: 'set_vtu_transaction_replay_attributes',
        args: {
          p_transaction_id: 'vtu-tx-existing',
          p_customer_phone: '08012345678',
          p_validation_reference: 'VRF-9',
        },
      },
    ]);
    expect(mockFulfill).toHaveBeenCalledWith({
      supabase: expect.anything(),
      transactionId: 'vtu-tx-existing',
    });
  });

  it('idempotent replay: invalid phone returns the same 400 as attempt 1', async () => {
    const state: IdempotencyRowState = {
      row: {
        key: VALID_KEY,
        vtu_transaction_id: 'vtu-tx-existing',
        customer_id: 'customer-1',
        merchant_id: 'merchant-1',
        request_fingerprint: VALID_BODY_FINGERPRINT,
      },
      insertCalls: 0,
      rpcCalls: [],
    };
    supabaseMockRef.current = buildSupabase(state);

    const { status, body } = await callRoute(
      makeRequest({
        idempotencyKey: VALID_KEY,
        body: { ...VALID_BODY, customerPhone: '12345' },
      })
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({ error: 'Invalid customer phone number' });
    expect(state.rpcCalls).toHaveLength(0);
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('changed-payload collision: same key with a different request fingerprint returns 409 instead of replaying', async () => {
    // Scenario: user submits airtime to phone A for ₦1000; request
    // times out so the mobile client (correctly) keeps the
    // Idempotency-Key. Before retrying, the user edits the form to
    // phone B / ₦2000. Without fingerprint protection the replay
    // would silently fulfill the original (phone A) transaction.
    // The route MUST refuse to replay and force the client to
    // generate a fresh key for the new intent.
    const state: IdempotencyRowState = {
      row: {
        key: VALID_KEY,
        vtu_transaction_id: 'vtu-tx-original',
        customer_id: 'customer-1',
        merchant_id: 'merchant-1',
        request_fingerprint: VALID_BODY_FINGERPRINT,
      },
      insertCalls: 0,
    };
    supabaseMockRef.current = buildSupabase(state);

    const changedBody = {
      ...VALID_BODY,
      phoneNumber: '08099999999',
      amount: 2000,
      walletAmount: 2000,
    };
    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY, body: changedBody })
    );

    expect(status).toBe(409);
    expect(body).toMatchObject({
      error: expect.stringContaining('different request payload'),
    });
    // Critical: do NOT touch fulfillment when the key was reused with
    // a different payload — that would be the silent-vend-wrong-target
    // bug we're protecting against.
    expect(mockFulfill).not.toHaveBeenCalled();
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(state.insertCalls).toBe(0);
  });

  it('records the request fingerprint on the fresh-key insert path', async () => {
    // Pin that the insert payload includes request_fingerprint so a
    // future regression that drops the column from the insert is
    // caught — without it, every replay would 409.
    const state: IdempotencyRowState = { row: null, insertCalls: 0 };
    supabaseMockRef.current = buildSupabase(state);
    mockPrepare.mockResolvedValue({
      transaction: { id: 'vtu-tx-new', merchant_id: 'merchant-1' },
      customer: { id: 'customer-1', email: 'c@example.com' },
      merchant: { id: 'merchant-1' },
    });
    mockFulfill.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-REF-NEW',
      status: 'successful',
    });

    const { status } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(200);
    expect(state.insertCalls).toBe(1);
    expect(state.row?.request_fingerprint).toBe(VALID_BODY_FINGERPRINT);
  });

  it('PK-race recovery: refuses to fulfill when the racing winner row is owned by another customer', async () => {
    // Scenario: two customers happen to submit with the same
    // Idempotency-Key. Customer-1's preparePendingVtuTransaction
    // creates vtu-tx-mine; the parallel Customer-2 wins the PK race
    // on `vtu_idempotency_keys.key`. Customer-1's insert fails;
    // Customer-1's recovery branch re-reads the table and finds the
    // row owned by Customer-2. Without an ownership check there,
    // Customer-1's HTTP response would carry Customer-2's
    // fulfillment payload — privilege-escalation-shaped.
    let lookupCallCount = 0;
    let insertCallCount = 0;
    const otherRow = {
      key: VALID_KEY,
      vtu_transaction_id: 'vtu-tx-other-customer',
      customer_id: 'OTHER-CUSTOMER',
      merchant_id: 'merchant-1',
    };
    supabaseMockRef.current = {
      from: vi.fn((table: string) => {
        if (table === 'vtu_idempotency_keys') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => {
                  lookupCallCount += 1;
                  // First lookup: empty (Customer-1 enters the
                  // "fresh-key" branch). Second lookup (post-PK
                  // failure recovery): the racing winner's row.
                  return Promise.resolve({
                    data: lookupCallCount === 1 ? null : otherRow,
                    error: null,
                  });
                }),
              })),
            })),
            insert: vi.fn(() => {
              insertCallCount += 1;
              return Promise.resolve({
                data: null,
                error: {
                  message: 'duplicate key value violates unique constraint',
                },
              });
            }),
          };
        }
        if (table === 'merchants') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: { id: 'merchant-1' },
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === 'customers') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'customer-1', email: 'c@example.com' },
                    error: null,
                  }),
                })),
              })),
            })),
          };
        }
        if (table === 'vtu_transactions') {
          return {
            delete: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn().mockResolvedValue({ error: null }),
                })),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn() })) })),
        };
      }),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    };

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(insertCallCount).toBe(1);
    expect(lookupCallCount).toBe(2);
    // The recovery branch MUST refuse to fulfill the winning row,
    // returning the same cross-customer-collision 400 the replay
    // path returns.
    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: expect.stringMatching(/idempotency/i),
    });
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('cross-customer collision: stored row owned by a different customer rejects with 400', async () => {
    const state: IdempotencyRowState = {
      row: {
        key: VALID_KEY,
        vtu_transaction_id: 'vtu-tx-other',
        customer_id: 'OTHER-CUSTOMER',
        merchant_id: 'merchant-1',
        request_fingerprint: VALID_BODY_FINGERPRINT,
      },
      insertCalls: 0,
    };
    supabaseMockRef.current = buildSupabase(state);
    // Authenticated user resolves to customer-1; existing row recorded
    // for OTHER-CUSTOMER → mismatch must reject.
    mockResolveVtuCustomer.mockResolvedValue({
      id: 'customer-1',
      email: 'c@example.com',
    });

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: expect.stringMatching(/idempotency/i),
    });
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('cross-storefront collision: same customer but row recorded under another merchant rejects with 400', async () => {
    // The fingerprint omits merchant binding, so the replay path
    // asserts the recorded merchant id structurally rather than
    // relying on per-merchant customer rows alone.
    const state: IdempotencyRowState = {
      row: {
        key: VALID_KEY,
        vtu_transaction_id: 'vtu-tx-other',
        customer_id: 'customer-1',
        merchant_id: 'merchant-OTHER',
        request_fingerprint: VALID_BODY_FINGERPRINT,
      },
      insertCalls: 0,
    };
    supabaseMockRef.current = buildSupabase(state);

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: expect.stringMatching(/storefront/i),
    });
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('PK-race recovery: refuses to fulfill when the racing winner row belongs to another storefront', async () => {
    let lookupCallCount = 0;
    const otherRow = {
      key: VALID_KEY,
      vtu_transaction_id: 'vtu-tx-other-merchant',
      customer_id: 'customer-1',
      merchant_id: 'merchant-OTHER',
      request_fingerprint: VALID_BODY_FINGERPRINT,
    };
    supabaseMockRef.current = {
      from: vi.fn((table: string) => {
        if (table === 'vtu_idempotency_keys') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(() => {
                  lookupCallCount += 1;
                  return Promise.resolve({
                    data: lookupCallCount === 1 ? null : otherRow,
                    error: null,
                  });
                }),
              })),
            })),
            insert: vi.fn(() =>
              Promise.resolve({
                data: null,
                error: {
                  message: 'duplicate key value violates unique constraint',
                },
              })
            ),
          };
        }
        if (table === 'vtu_transactions') {
          return {
            delete: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn().mockResolvedValue({ error: null }),
                })),
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn() })) })),
        };
      }),
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
    };

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(lookupCallCount).toBe(2);
    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: expect.stringMatching(/storefront/i),
    });
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('replay: transient merchant lookup error 500s (key kept), never 400', async () => {
    // A swallowed lookup error would collapse into the 400
    // ownership-mismatch below and rotate the client's key; a retry
    // after the database recovers would then mint fresh and debit
    // twice. Errors must 500 so the key is kept for replay.
    const state: IdempotencyRowState = {
      row: {
        key: VALID_KEY,
        vtu_transaction_id: 'vtu-tx-existing',
        customer_id: 'customer-1',
        merchant_id: 'merchant-1',
        request_fingerprint: VALID_BODY_FINGERPRINT,
      },
      insertCalls: 0,
    };
    const base = buildSupabase(state);
    const baseFrom = base.from as unknown as (table: string) => unknown;
    supabaseMockRef.current = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === 'merchants') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'connection reset' },
                }),
              })),
            })),
          };
        }
        return baseFrom(table);
      }),
    };
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(500);
    expect(body).toMatchObject({ error: 'Wallet-only checkout failed.' });
    expect(mockFulfill).not.toHaveBeenCalled();
    expect(mockResolveVtuCustomer).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('replay: alias-lookup failure 500s (key kept), never 400', async () => {
    // A lenient alias miss (null with no error) would collapse into the
    // 400 ownership-mismatch and rotate the client's key; after the
    // alias lookup recovers, the retry would mint fresh and debit a
    // second time. Strict resolution 500s so the key is kept.
    const state: IdempotencyRowState = {
      row: {
        key: VALID_KEY,
        vtu_transaction_id: 'vtu-tx-existing',
        customer_id: 'customer-1',
        merchant_id: 'merchant-1',
        request_fingerprint: VALID_BODY_FINGERPRINT,
      },
      insertCalls: 0,
    };
    const base = buildSupabase(state);
    const baseFrom = base.from as unknown as (table: string) => unknown;
    supabaseMockRef.current = {
      ...base,
      from: vi.fn((table: string) => {
        if (table === 'merchants') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              })),
            })),
          };
        }
        return baseFrom(table);
      }),
    };
    mockGetCurrentSlugForAliasStrict.mockRejectedValue(
      new Error('[Slug Alias Cache] alias lookup failed for slug: ogabassey')
    );
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(500);
    expect(body).toMatchObject({ error: 'Wallet-only checkout failed.' });
    expect(mockFulfill).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('replay: strict customer-resolver failure 500s without leaking DB text', async () => {
    const state: IdempotencyRowState = {
      row: {
        key: VALID_KEY,
        vtu_transaction_id: 'vtu-tx-existing',
        customer_id: 'customer-1',
        merchant_id: 'merchant-1',
        request_fingerprint: VALID_BODY_FINGERPRINT,
      },
      insertCalls: 0,
    };
    supabaseMockRef.current = buildSupabase(state);
    mockResolveVtuCustomer.mockRejectedValueOnce(
      new Error('Failed to look up VTU customer: connection reset')
    );
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(500);
    expect(body).toMatchObject({ error: 'Wallet-only checkout failed.' });
    expect(mockResolveVtuCustomer).toHaveBeenCalledWith(
      expect.objectContaining({ strictLookups: true })
    );
    expect(mockFulfill).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('fresh path: prepare runs with strictLookups so transient errors 500', async () => {
    const state: IdempotencyRowState = { row: null, insertCalls: 0 };
    supabaseMockRef.current = buildSupabase(state);

    const { status } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(200);
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.objectContaining({ strictLookups: true })
    );
  });
});

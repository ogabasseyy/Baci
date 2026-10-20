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
  VTU_TYPE_LABELS: { airtime: 'Airtime' },
}));

// resolveRequestingOwnership resolves via vtu-customer-resolution
// directly (not the pending-transaction re-export), so the replay
// path never imports the preparation module's provider graph.
vi.mock('@/lib/vtu-customer-resolution', () => ({
  resolveVtuCustomer: mockResolveVtuCustomer,
}));

vi.mock('@/lib/vtu-fulfillment', () => ({
  fulfillPendingVtuTransaction: mockFulfill,
}));

interface MockSupabase {
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
}

const supabaseMockRef: { current: MockSupabase | null } = { current: null };
const userSupabaseMockRef: { current: MockSupabase | null } = {
  current: null,
};

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => supabaseMockRef.current,
}));

// Import the route AFTER all mocks are registered. Using a factory call
// inside `beforeEach` (instead of a top-level import) lets each test
// rebuild the supabase mock and have the route handler pick it up.
async function callRoute(
  request: NextRequest
): Promise<{ status: number; body: unknown; headers: Headers }> {
  const { POST } = await import('./route');
  const response = await POST(request);
  const body = await response.json().catch(() => null);
  return { status: response.status, body, headers: response.headers };
}

/** Delete-chain starters issued against vtu_transactions (orphan-cleanup observation). */
function vtuTransactionDeletes(): ReturnType<typeof vi.fn>[] {
  const fromMock = supabaseMockRef.current?.from;
  return (fromMock?.mock.results ?? [])
    .map(
      (result) =>
        (result.value as { delete?: ReturnType<typeof vi.fn> } | undefined)
          ?.delete
    )
    .filter(
      (del): del is ReturnType<typeof vi.fn> => typeof del === 'function'
    );
}

interface ClaimMapping {
  key: string;
  vtu_transaction_id: string;
  customer_id: string;
  merchant_id: string;
  request_fingerprint: string;
}

interface ClaimResult {
  data: Array<{
    transaction_id: string;
    idempotency_key: string;
    created: boolean;
  }> | null;
  error: { message: string } | null;
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
  /** claim_vtu_intent calls (the RPC replaced the direct insert). */
  claimCalls?: number;
  /** Per-test claim override; default below mirrors RPC semantics. */
  claimImpl?: (
    args: Record<string, string>
  ) => ClaimResult | Promise<ClaimResult>;
  /** In-memory mappings + txn statuses for the default claim impl. */
  claimStore?: {
    rows: ClaimMapping[];
    txnStatus: Record<string, string>;
  };
}

/**
 * Faithful sequential mirror of the claim_vtu_intent RPC: same key
 * first (immutable mapping, scope/fingerprint asserted), then the
 * earliest in-flight scope winner, else record. Terminal (successful/
 * failed) transactions are never joined. True two-backend race
 * serialization is proven against live Postgres during development,
 * not here — this mock interleaves deterministically.
 */
function defaultClaim(
  state: IdempotencyRowState,
  args: Record<string, string>
): ClaimResult {
  if (!state.claimStore) {
    state.claimStore = { rows: [], txnStatus: {} };
  }
  const store = state.claimStore;
  const key = args.p_key;
  const fingerprint = args.p_fingerprint;
  const transactionId = args.p_transaction_id;
  const merchantId = args.p_merchant_id;
  const customerId = args.p_customer_id;
  const statusOf = (id: string) => store.txnStatus[id] ?? 'processing';
  const sameKey = store.rows.find((r) => r.key === key);
  if (sameKey) {
    if (
      sameKey.merchant_id !== merchantId ||
      sameKey.customer_id !== customerId
    ) {
      return {
        data: null,
        error: { message: 'claim_scope_mismatch: test collision' },
      };
    }
    if (sameKey.request_fingerprint !== fingerprint) {
      return {
        data: null,
        error: { message: 'claim_fingerprint_mismatch: test collision' },
      };
    }
    state.row = { ...sameKey };
    return {
      data: [
        {
          transaction_id: sameKey.vtu_transaction_id,
          idempotency_key: sameKey.key,
          created: false,
        },
      ],
      error: null,
    };
  }
  const winner = store.rows.find(
    (r) =>
      r.merchant_id === merchantId &&
      r.customer_id === customerId &&
      r.request_fingerprint === fingerprint &&
      statusOf(r.vtu_transaction_id) !== 'successful' &&
      statusOf(r.vtu_transaction_id) !== 'failed'
  );
  if (winner) {
    state.row = { ...winner };
    return {
      data: [
        {
          transaction_id: winner.vtu_transaction_id,
          idempotency_key: winner.key,
          created: false,
        },
      ],
      error: null,
    };
  }
  const row = {
    key,
    vtu_transaction_id: transactionId,
    customer_id: customerId,
    merchant_id: merchantId,
    request_fingerprint: fingerprint,
  };
  store.rows.push(row);
  state.row = { ...row };
  return {
    data: [
      { transaction_id: transactionId, idempotency_key: key, created: true },
    ],
    error: null,
  };
}

function buildSupabase(
  state: IdempotencyRowState,
  options?: {
    requestingCustomerId?: string;
    /**
     * Replay owner binding row (Muse R119). Undefined = derive a
     * matching row from the live idempotency state; null = the
     * transaction row is missing; object = as given (mismatch).
     */
    transactionBinding?: {
      customer_id: string | null;
      id: string;
      merchant_id: string | null;
      status: string | null;
    } | null;
    /**
     * Replay owner customer row (Muse R128). Default = linked to the
     * auth user; null = vanished row; user_id null or foreign =
     * unbound owner the read-only replay rejects with 425 (key kept,
     * Codex R152 P1) — never a fresh-key rotation.
     */
    customerRow?: {
      email: string | null;
      id: string;
      user_id: string | null;
    } | null;
  }
): MockSupabase {
  // The route resolves the requesting customer before validating
  // ownership of an existing idempotency row. Default the lookup to the
  // user's "customer-1" id so happy/replay paths pass; tests that
  // exercise the cross-customer collision pass a different value here.
  const requestingCustomerId = options?.requestingCustomerId ?? 'customer-1';
  const customerRow =
    options?.customerRow !== undefined
      ? options.customerRow
      : {
          email: 'c@example.com',
          id: requestingCustomerId,
          user_id: AUTH_USER_ID,
        };
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
        // Also serves the R128 replay-owner presence read
        // (select.eq(id).maybeSingle).
        const customerMaybeSingle = vi.fn().mockResolvedValue({
          data: customerRow,
          error: null,
        });
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: customerMaybeSingle,
              })),
              maybeSingle: customerMaybeSingle,
            })),
          })),
        };
      }
      if (table === 'vtu_transactions') {
        return {
          delete: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  select: vi.fn(() => ({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: { id: 'vtu-tx-new' },
                      error: null,
                    }),
                  })),
                })),
              })),
            })),
          })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: { id: 'vtu-tx-new' },
                    error: null,
                  }),
                })),
              })),
            })),
          })),
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn().mockImplementation(() => {
                // Lazily derived: the fresh path inserts the key row
                // after this mock is built.
                const binding =
                  options?.transactionBinding !== undefined
                    ? options.transactionBinding
                    : state.row
                      ? {
                          id: state.row.vtu_transaction_id,
                          customer_id: state.row.customer_id,
                          merchant_id: state.row.merchant_id,
                          status: 'processing',
                        }
                      : {
                          id: 'vtu-tx-new',
                          customer_id: 'customer-1',
                          merchant_id: 'merchant-1',
                          status: 'processing',
                        };
                return Promise.resolve({ data: binding, error: null });
              }),
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
    rpc: vi.fn((fn: string, args: Record<string, string>) => {
      state.rpcCalls?.push({ fn, args });
      if (fn !== 'claim_vtu_intent') {
        return Promise.resolve({ data: null, error: null });
      }
      state.claimCalls = (state.claimCalls ?? 0) + 1;
      if (state.claimImpl) {
        return Promise.resolve(state.claimImpl(args));
      }
      return Promise.resolve(defaultClaim(state, args));
    }),
  };
}

const AUTH_USER_ID = '11111111-1111-4111-8111-111111111111';

const VALID_BODY = {
  merchantSlug: 'ogabassey',
  type: 'airtime',
  amount: 1000,
  walletAmount: 1000,
  phoneNumber: '08012345678',
  networkProvider: 'MTN',
  expectedUserId: AUTH_USER_ID,
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
    userSupabaseMockRef.current = buildSupabase({
      row: null,
      insertCalls: 0,
    });
    mockAuthenticate.mockResolvedValue({
      user: { id: AUTH_USER_ID, email: 'c@example.com' },
      error: null,
      supabase: userSupabaseMockRef.current,
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

  it('rejects with 401 when authentication yields no user client', async () => {
    // The replay overlay must run on the authenticated user client
    // (ownership-enforced RPC) — never fall back to service role, so
    // a missing user client fails the request instead.
    mockAuthenticate.mockResolvedValue({
      user: { id: AUTH_USER_ID, email: 'c@example.com' },
      error: null,
      supabase: null,
    });

    const { status } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(401);
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockFulfill).not.toHaveBeenCalled();
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

  it('binds a missing expectedUserId to the session user (legacy clients)', async () => {
    // Codex R137 P1: already-deployed mobile builds and stale web
    // bundles call this endpoint without the pin — rejecting would
    // 400 every legacy purchase on backend deploy. Omission binds
    // to the session user (pre-pin behavior); only a PRESENT
    // mismatch 403s. Omission cannot impersonate: the binding
    // target is server-derived, it only forgoes switch detection.
    const { expectedUserId: _omitted, ...bodyWithoutBinding } = VALID_BODY;
    expect(_omitted).toBe(AUTH_USER_ID);
    const state: IdempotencyRowState = { row: null, insertCalls: 0 };
    supabaseMockRef.current = buildSupabase(state);

    const { status } = await callRoute(
      makeRequest({
        idempotencyKey: VALID_KEY,
        body: bodyWithoutBinding,
      })
    );

    expect(status).toBe(200);
    expect(mockPrepare).toHaveBeenCalledTimes(1);
    expect(mockFulfill).toHaveBeenCalled();
  });

  it('proceeds when the captured user matches the session', async () => {
    const SUBMITTER = '33333333-3333-4333-8333-333333333333';
    mockAuthenticate.mockResolvedValue({
      user: { id: SUBMITTER, email: 'c@example.com' },
      error: null,
      supabase: userSupabaseMockRef.current,
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
    expect(state.claimCalls).toBe(1);
    // The claim RPC replaced the direct insert: no table write.
    expect(state.insertCalls).toBe(0);
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
    // The overlay runs on the AUTHENTICATED user client (ownership-
    // enforced RPC), never the service-role client.
    const userState: IdempotencyRowState = {
      row: null,
      insertCalls: 0,
      rpcCalls: [],
    };
    mockAuthenticate.mockResolvedValue({
      user: { id: AUTH_USER_ID, email: 'c@example.com' },
      error: null,
      supabase: buildSupabase(userState),
    });
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
    expect(userState.rpcCalls).toEqual([
      {
        fn: 'set_vtu_transaction_replay_attributes',
        args: {
          p_transaction_id: 'vtu-tx-existing',
          p_customer_phone: '08012345678',
          p_validation_reference: 'VRF-9',
        },
      },
    ]);
    expect(state.rpcCalls).toEqual([]);
    expect(mockFulfill).toHaveBeenCalledWith({
      supabase: expect.anything(),
      transactionId: 'vtu-tx-existing',
    });
  });

  it('idempotent replay: invalid phone is ignored and the stored transaction replays', async () => {
    // The row already carries attempt-1-validated state: an invalid
    // incoming phone degrades to omitted instead of 400ing the replay
    // — a 400 would rotate the clients' retained key, so the corrected
    // retry would mint fresh and debit twice (Codex R37 rktSo).
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
    const userState: IdempotencyRowState = {
      row: null,
      insertCalls: 0,
      rpcCalls: [],
    };
    mockAuthenticate.mockResolvedValue({
      user: { id: AUTH_USER_ID, email: 'c@example.com' },
      error: null,
      supabase: buildSupabase(userState),
    });
    mockFulfill.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-REF-OLD',
      status: 'successful',
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { status } = await callRoute(
        makeRequest({
          idempotencyKey: VALID_KEY,
          body: {
            ...VALID_BODY,
            customerPhone: '12345',
            validationReference: 'VRF-9',
          },
        })
      );

      expect(status).toBe(200);
      expect(userState.rpcCalls).toEqual([
        {
          fn: 'set_vtu_transaction_replay_attributes',
          args: {
            p_transaction_id: 'vtu-tx-existing',
            p_customer_phone: null,
            p_validation_reference: 'VRF-9',
          },
        },
      ]);
      expect(state.rpcCalls).toEqual([]);
      expect(mockFulfill).toHaveBeenCalledWith({
        supabase: expect.anything(),
        transactionId: 'vtu-tx-existing',
      });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
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

  it('records the request fingerprint on the fresh-key claim path', async () => {
    // Pin that the claim payload includes the fingerprint so a
    // future regression that drops it from the RPC args is caught —
    // without it, every replay would 409.
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
    expect(state.claimCalls).toBe(1);
    expect(state.insertCalls).toBe(0);
    expect(state.row?.request_fingerprint).toBe(VALID_BODY_FINGERPRINT);
    const claimCall = (
      supabaseMockRef.current?.rpc as ReturnType<typeof vi.fn>
    ).mock.calls
      .map((call) => call as [string, Record<string, string>])
      .find(([fn]) => fn === 'claim_vtu_intent');
    expect(claimCall?.[1]).toMatchObject({
      p_key: VALID_KEY,
      p_fingerprint: VALID_BODY_FINGERPRINT,
      p_transaction_id: 'vtu-tx-new',
      p_merchant_id: 'merchant-1',
      p_customer_id: 'customer-1',
    });
  });

  it('claim race: refuses when the key is mapped under another scope (400)', async () => {
    // Same-key collision across scopes (key-UUID collision in
    // practice — the route's ownership checks already reject
    // cross-tenant keys before the claim). The RPC asserts BOTH
    // scope parts (merchant + customer) in one condition, so one
    // route-level test pins the mapping; the DB contract pins
    // merchant isolation separately. claim_scope_mismatch maps to
    // the same cross-customer 400 the replay path returns — never
    // the winner's fulfillment payload (privilege-escalation-shaped).
    const state: IdempotencyRowState = {
      row: null,
      insertCalls: 0,
      claimImpl: () => ({
        data: null,
        error: { message: 'claim_scope_mismatch: test collision' },
      }),
    };
    supabaseMockRef.current = buildSupabase(state);

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(state.claimCalls).toBe(1);
    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: expect.stringMatching(/idempotency/i),
    });
    expect(mockFulfill).not.toHaveBeenCalled();
    // Rejection cleanup (Codex R1 P2): the certain-abort claim
    // orphaned our prepared row — the guarded delete targeted it.
    const deletes = vtuTransactionDeletes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toHaveBeenCalledTimes(1);
    const firstEq = deletes[0]?.mock.results[0]?.value as {
      eq?: ReturnType<typeof vi.fn>;
    };
    expect(firstEq?.eq?.mock.calls[0]).toEqual(['id', 'vtu-tx-new']);
  });

  it('claim join: marks the orphan failed when its delete fails, then replays the winner', async () => {
    // Loser path: our key joins another key's in-flight transaction.
    // Our prepared row is discarded via the existing orphan cleanup
    // (Muse R55 HIGH: a failed delete falls back to the terminal
    // failed mark — never log-and-continue), the winner is replayed,
    // and the joined response carries the winner key for client
    // adoption. The cleanup outcome never masks the replay.
    const WINNER_KEY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const markPayloads: Record<string, unknown>[] = [];
    mockPrepare.mockResolvedValue({
      transaction: { id: 'vtu-tx-mine', merchant_id: 'merchant-1' },
      customer: { id: 'customer-1', email: 'c@example.com' },
      merchant: { id: 'merchant-1' },
    });
    mockFulfill.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-REF-WINNER',
      status: 'successful',
    });
    supabaseMockRef.current = {
      from: vi.fn((table: string) => {
        if (table === 'vtu_idempotency_keys') {
          // Fresh key: the PK lookup misses; the claim joins.
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
          // R128 replay-owner claim: single-eq read for a linked row.
          const customerMaybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'customer-1',
              email: 'c@example.com',
              user_id: AUTH_USER_ID,
            },
            error: null,
          });
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: customerMaybeSingle,
                })),
                maybeSingle: customerMaybeSingle,
              })),
            })),
          };
        }
        if (table === 'vtu_transactions') {
          return {
            delete: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    select: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: null,
                        error: { message: 'connection reset' },
                      }),
                    })),
                  })),
                })),
              })),
            })),
            select: vi.fn((columns?: string) => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue(
                  columns === 'id, customer_id, merchant_id, status'
                    ? // Replay owner binding (Muse R119): the winner's
                      // row belongs to the key owner.
                      {
                        data: {
                          id: 'vtu-tx-winner',
                          customer_id: 'customer-1',
                          merchant_id: 'merchant-1',
                          status: 'processing',
                        },
                        error: null,
                      }
                    : {
                        data: {
                          id: 'vtu-tx-mine',
                          metadata: { provider: 'kuda' },
                          status: 'pending',
                        },
                        error: null,
                      }
                ),
              })),
            })),
            update: vi.fn((payload: Record<string, unknown>) => {
              markPayloads.push(payload);
              return {
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    select: vi.fn(() => ({
                      maybeSingle: vi.fn().mockResolvedValue({
                        data: { id: 'vtu-tx-mine' },
                        error: null,
                      }),
                    })),
                  })),
                })),
              };
            }),
          };
        }
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn() })) })),
        };
      }),
      rpc: vi.fn((fn: string) => {
        if (fn === 'claim_vtu_intent') {
          return Promise.resolve({
            data: [
              {
                transaction_id: 'vtu-tx-winner',
                idempotency_key: WINNER_KEY,
                created: false,
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const { status, body, headers } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({ reference: 'VTU-REF-WINNER' });
    expect(markPayloads).toHaveLength(1);
    expect(markPayloads[0]).toMatchObject({
      error_message: expect.stringContaining('no charge was made'),
      status: 'failed',
    });
    expect(mockFulfill).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'vtu-tx-winner' })
    );
    // Winner-key wire: the loser's key has no mapping, so the
    // joined response carries the winner key for client adoption.
    expect(headers.get('X-Vtu-Canonical-Idempotency-Key')).toBe(WINNER_KEY);
  });

  it('claim twin: same-transaction mapping fulfills directly without cleanup', async () => {
    // Same key re-claimed (lost-response re-entry) or a PK-race
    // twin: the claim returns our own prepared transaction
    // (created=false, same txn id). No orphan exists, so cleanup
    // must NOT run (deleting our own row would strand the key),
    // and our row is fulfilled directly. No winner-key wire
    // either: the client's key is already the mapped key.
    const deleteSpy = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'vtu-tx-mine' },
                error: null,
              }),
            })),
          })),
        })),
      })),
    }));
    const updateSpy = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { id: 'vtu-tx-mine' }, error: null }),
          })),
        })),
      })),
    }));
    mockPrepare.mockResolvedValue({
      transaction: { id: 'vtu-tx-mine', merchant_id: 'merchant-1' },
      customer: { id: 'customer-1', email: 'c@example.com' },
      merchant: { id: 'merchant-1' },
    });
    mockFulfill.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-REF-MINE',
      status: 'successful',
    });
    supabaseMockRef.current = {
      from: vi.fn((table: string) => {
        if (table === 'vtu_idempotency_keys') {
          // Fresh key: the PK lookup misses; the claim adopts.
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
        if (table === 'vtu_transactions') {
          return {
            delete: deleteSpy,
            update: updateSpy,
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'vtu-tx-mine',
                    customer_id: 'customer-1',
                    merchant_id: 'merchant-1',
                    status: 'pending',
                  },
                  error: null,
                }),
              })),
            })),
          };
        }
        if (table === 'customers') {
          // R128 replay-owner claim: linked row short-circuits.
          const customerMaybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'customer-1',
              email: 'c@example.com',
              user_id: AUTH_USER_ID,
            },
            error: null,
          });
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: customerMaybeSingle,
              })),
            })),
          };
        }
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn() })) })),
        };
      }),
      rpc: vi.fn((fn: string) => {
        if (fn === 'claim_vtu_intent') {
          return Promise.resolve({
            data: [
              {
                transaction_id: 'vtu-tx-mine',
                idempotency_key: VALID_KEY,
                created: false,
              },
            ],
            error: null,
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const { status, headers } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(200);
    // Our own row is fulfilled, never cleaned up.
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(mockFulfill).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'vtu-tx-mine' })
    );
    expect(headers.get('X-Vtu-Canonical-Idempotency-Key')).toBeNull();
  });

  it('claim race: concurrent checkouts with distinct keys join a single transaction', async () => {
    // The double-debit window, closed: two submits with distinct
    // keys + the same fingerprint (second tab/device, registry
    // loss) interleave. Exactly one mapping row is recorded; both
    // responses resolve the SAME transaction (the loser replays
    // the winner after discarding its prepared row), so
    // fulfillment — idempotent per transaction id — debits once.
    const KEY_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const KEY_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
    const state: IdempotencyRowState = { row: null, insertCalls: 0 };
    supabaseMockRef.current = buildSupabase(state);
    mockPrepare
      .mockResolvedValueOnce({
        transaction: { id: 'vtu-tx-a', merchant_id: 'merchant-1' },
        customer: { id: 'customer-1', email: 'c@example.com' },
        merchant: { id: 'merchant-1' },
      })
      .mockResolvedValueOnce({
        transaction: { id: 'vtu-tx-b', merchant_id: 'merchant-1' },
        customer: { id: 'customer-1', email: 'c@example.com' },
        merchant: { id: 'merchant-1' },
      });
    mockFulfill.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-REF-RACE',
      status: 'successful',
    });

    const [resA, resB] = await Promise.all([
      callRoute(makeRequest({ idempotencyKey: KEY_A })),
      callRoute(makeRequest({ idempotencyKey: KEY_B })),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(state.claimCalls).toBe(2);
    // Single mapping row: the second claim joined, not recorded.
    expect(state.claimStore?.rows).toHaveLength(1);
    const winnerTxn = state.claimStore?.rows[0]?.vtu_transaction_id;
    // Both checkouts drove the SAME transaction (the winner
    // fulfills; the loser re-drives idempotently via replay).
    expect(mockFulfill).toHaveBeenCalledTimes(2);
    for (const call of mockFulfill.mock.calls) {
      expect(call[0]).toMatchObject({ transactionId: winnerTxn });
    }
    // Exactly one response carries the wire (the loser's).
    const wires = [resA, resB].map((r) =>
      r.headers.get('X-Vtu-Canonical-Idempotency-Key')
    );
    expect(wires.filter(Boolean)).toHaveLength(1);
    expect(wires).toContain(state.claimStore?.rows[0]?.key);
  });

  it.each([
    'successful',
    'failed',
  ])('claim after terminal %s: starts a new purchase instead of joining', async (terminalStatus) => {
    // Repeat purchases share fingerprints: once the prior
    // occurrence terminalized, a new key MUST create (joining a
    // success would under-deliver; joining a failure would loop
    // — failures rotate keys).
    const OLD_KEY = 'cccccccc-3333-4333-8333-cccccccccccc';
    const state: IdempotencyRowState = {
      row: null,
      insertCalls: 0,
      claimStore: {
        rows: [
          {
            key: OLD_KEY,
            vtu_transaction_id: 'vtu-tx-old',
            customer_id: 'customer-1',
            merchant_id: 'merchant-1',
            request_fingerprint: VALID_BODY_FINGERPRINT,
          },
        ],
        txnStatus: { 'vtu-tx-old': terminalStatus },
      },
    };
    supabaseMockRef.current = buildSupabase(state);
    mockFulfill.mockResolvedValue({
      amount: 1000,
      reference: 'VTU-REF-NEW',
      status: 'successful',
    });

    const { status } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(200);
    expect(mockFulfill).toHaveBeenCalledWith(
      expect.objectContaining({ transactionId: 'vtu-tx-new' })
    );
    expect(state.claimStore?.rows).toHaveLength(2);
  });

  it('claim race: same key mapped with another fingerprint returns 409', async () => {
    // Same-key changed-payload race (form edited between submits):
    // the RPC raises claim_fingerprint_mismatch; the route maps it
    // to the same rotation-instructing 409 the replay path returns.
    const state: IdempotencyRowState = {
      row: null,
      insertCalls: 0,
      claimImpl: () => ({
        data: null,
        error: { message: 'claim_fingerprint_mismatch: test collision' },
      }),
    };
    supabaseMockRef.current = buildSupabase(state);

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(409);
    expect(body).toMatchObject({
      error: expect.stringMatching(/different request payload/),
    });
    expect(mockFulfill).not.toHaveBeenCalled();
    // Rejection cleanup (Codex R1 P2): the certain-abort claim
    // orphaned our prepared row — the guarded delete targeted it.
    const deletes = vtuTransactionDeletes();
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toHaveBeenCalledTimes(1);
    const firstEq = deletes[0]?.mock.results[0]?.value as {
      eq?: ReturnType<typeof vi.fn>;
    };
    expect(firstEq?.eq?.mock.calls[0]).toEqual(['id', 'vtu-tx-new']);
  });

  it('fresh claim: success response carries no canonical-key wire', async () => {
    // The client knows its own key on the fresh path; the wire
    // exists only for joins (clients converge retries on it).
    const state: IdempotencyRowState = { row: null, insertCalls: 0 };
    supabaseMockRef.current = buildSupabase(state);

    const { status, headers } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(200);
    expect(headers.get('X-Vtu-Canonical-Idempotency-Key')).toBeNull();
  });

  it('claim with no mapping row 500s (defensive: RPC returns exactly one row)', async () => {
    const state: IdempotencyRowState = {
      row: null,
      insertCalls: 0,
      claimImpl: () => ({ data: [], error: null }),
    };
    supabaseMockRef.current = buildSupabase(state);
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    const { status } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(500);
    expect(mockFulfill).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('claim transport failure: 500s without logging the raw idempotency key, no blind cleanup', async () => {
    // Muse R108 MEDIUM: the key is the unguessable replay
    // credential — error logs and responses must carry the
    // prepared transaction id, never the key. Deliberate change
    // from the old R131 orphan-delete: a failed claim response may
    // still have committed, so blind cleanup could delete a
    // REFERENCED row (CASCADE kills the mapping) — the route does
    // nothing but 500, and the retained-key retry is safe via the
    // RPC's same-key-first contract.
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const deleteSpy = vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: 'vtu-tx-new' },
                error: null,
              }),
            })),
          })),
        })),
      })),
    }));
    supabaseMockRef.current = {
      from: vi.fn((table: string) => {
        if (table === 'vtu_idempotency_keys') {
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
          // R128 replay-owner claim: single-eq read for a linked row.
          const customerMaybeSingle = vi.fn().mockResolvedValue({
            data: {
              id: 'customer-1',
              email: 'c@example.com',
              user_id: AUTH_USER_ID,
            },
            error: null,
          });
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: customerMaybeSingle,
                })),
                maybeSingle: customerMaybeSingle,
              })),
            })),
          };
        }
        if (table === 'vtu_transactions') {
          return {
            delete: deleteSpy,
          };
        }
        return {
          select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn() })) })),
        };
      }),
      rpc: vi.fn((fn: string) => {
        if (fn === 'claim_vtu_intent') {
          return Promise.resolve({
            data: null,
            error: { message: 'connection reset' },
          });
        }
        return Promise.resolve({ data: null, error: null });
      }),
    };

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalled();
    for (const call of consoleErrorSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(VALID_KEY);
    }
    expect(JSON.stringify(body)).not.toContain(VALID_KEY);
    // No blind cleanup: the claim may have committed.
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(mockFulfill).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
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
    // Muse R127 MEDIUM (pre-guard probe): the rejection carries a
    // static string — no stored row fields (tx id, owner ids).
    expect((body as { error: string }).error).not.toMatch(
      /vtu-tx-other|OTHER-CUSTOMER/
    );
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
    // Muse R127 MEDIUM (pre-guard probe): static string only.
    expect((body as { error: string }).error).not.toMatch(
      /vtu-tx-other|merchant-OTHER/
    );
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('replay: unlinked email-matched owner rejects with 425 (key kept), no fulfill', async () => {
    // Muse R128 MEDIUM via Codex R129 P1: legacy/manual key rows can
    // reference an unlinked guest customer. The replay path is
    // READ-ONLY for customers (linking happens only on the fresh
    // path inside prepare), so the replay must not debit a row never
    // linked to the caller. 425, not 400 (Codex R152 P1): a 400
    // would rotate to a fresh key whose fresh prepare links this
    // same customer and can debit a second transaction.
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
    supabaseMockRef.current = buildSupabase(state, {
      customerRow: {
        email: 'c@example.com',
        id: 'customer-1',
        user_id: null,
      },
    });

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(425);
    expect(body).toMatchObject({
      error: expect.stringMatching(
        /same purchase instead of starting a new one/
      ),
    });
    expect((body as { error: string }).error).not.toMatch(/fresh key/i);
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('replay: vanished replay owner rejects with 425 (key kept), no fulfill', async () => {
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
    supabaseMockRef.current = buildSupabase(state, { customerRow: null });

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(425);
    expect(body).toMatchObject({
      error: expect.stringMatching(
        /same purchase instead of starting a new one/
      ),
    });
    expect((body as { error: string }).error).not.toMatch(/fresh key/i);
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('replay: owner linked to another user after the guards rejects with 425 (key kept), no fulfill', async () => {
    // Lost the post-guard race: the row was claimed by someone else
    // between ownership resolution and the presence read. Fail
    // closed — the read-only replay never writes the link — with
    // 425 (Codex R152 P1), since a 400 rotation could debit a second
    // transaction under a fresh key.
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
    supabaseMockRef.current = buildSupabase(state, {
      customerRow: {
        email: 'c@example.com',
        id: 'customer-1',
        user_id: 'other-user-id',
      },
    });

    const { status } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(425);
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('replay binding: transaction row owned by another customer rejects with 400, no fulfill', async () => {
    // Muse R119 MEDIUM: the key-row guards passed, but the
    // transaction row points at a different customer (orphan
    // leftover, manual repair). Fulfilling would debit/refund the
    // wrong customer — bind key↔tx before fulfilling.
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
    supabaseMockRef.current = buildSupabase(state, {
      transactionBinding: {
        id: 'vtu-tx-existing',
        customer_id: 'OTHER-CUSTOMER',
        merchant_id: 'merchant-1',
        status: 'processing',
      },
    });

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: expect.stringMatching(/does not belong to this purchase/i),
    });
    expect(mockFulfill).not.toHaveBeenCalled();
  });

  it('replay binding: missing transaction row rejects with 400, no fulfill', async () => {
    // The key survived but its transaction row is gone: terminal
    // for this key (400 rotates to a fresh purchase), never fulfill
    // into the void.
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
    supabaseMockRef.current = buildSupabase(state, {
      transactionBinding: null,
    });

    const { status, body } = await callRoute(
      makeRequest({ idempotencyKey: VALID_KEY })
    );

    expect(status).toBe(400);
    expect(body).toMatchObject({
      error: expect.stringMatching(/no longer exists/i),
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

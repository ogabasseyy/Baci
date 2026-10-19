import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import {
  DEFAULT_TIMEOUT,
  HttpError,
  NetworkError,
  TimeoutError,
} from '@/lib/fetch-with-timeout';
import { MOBILE_TO_KUDA_PROVIDER } from '@/lib/network-utils';
import {
  clearPendingVtuKeys,
  recallPendingVtuKey,
  rememberPendingVtuPurchase,
} from '@/lib/pending-vtu-idempotency';
import {
  chargeWalletForVtu,
  confirmVtuCheckout,
  listSavedVtuCards,
  normalizeVtuCheckoutPayload,
  shouldRotateWalletIdempotencyKeyForError,
  VTU_CHECKOUT_WALLET_ONLY_URL,
  VtuPaymentStillProcessingError,
  waitForVtuConfirmation,
} from '@/lib/vtu-checkout';

type MockFetchResponse = {
  ok: boolean;
  status?: number;
  json: () => Promise<Record<string, unknown>>;
};

type JsonRequestInit = RequestInit & {
  body: string;
};

type MockUserResult = {
  data: { user: { id: string } | null };
  error: Error | null;
};

type MockSessionResult = {
  data: {
    session: { access_token: string; user?: { id: string } | null } | null;
  };
};

const mockFetchWithTimeout =
  jest.fn<(...args: unknown[]) => Promise<MockFetchResponse>>();

type MockDeadlineResult = {
  data: Record<string, unknown>;
  response: {
    ok: boolean;
    status?: number;
    headers: { get: (name: string) => string | null };
  };
};

const mockFetchJsonWithDeadline =
  jest.fn<(...args: unknown[]) => Promise<MockDeadlineResult>>();
const mockGetUser = jest.fn<() => Promise<MockUserResult>>();
const mockGetSession = jest.fn<() => Promise<MockSessionResult>>();

function getMockRequestInit(callIndex = 0): JsonRequestInit {
  const requestInit = mockFetchJsonWithDeadline.mock.calls[callIndex]?.[1];
  expect(requestInit).toHaveProperty('body');
  if (!requestInit || typeof (requestInit as RequestInit).body !== 'string') {
    throw new Error('Expected request body to be a JSON string');
  }
  return requestInit as JsonRequestInit;
}

function parseMockRequestBody(callIndex = 0): Record<string, unknown> {
  const checkoutRequest = getMockRequestInit(callIndex);
  return JSON.parse(checkoutRequest.body) as Record<string, unknown>;
}

jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    expoConfig: {
      extra: {},
    },
  },
}));

jest.mock('@/lib/fetch-with-timeout', () => {
  const actual = jest.requireActual<typeof import('@/lib/fetch-with-timeout')>(
    '@/lib/fetch-with-timeout'
  );
  return {
    ...actual,
    fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
  };
});

jest.mock('@baci/shared', () => {
  const actual =
    jest.requireActual<typeof import('@baci/shared')>('@baci/shared');
  return {
    ...actual,
    fetchJsonWithDeadline: (...args: unknown[]) =>
      mockFetchJsonWithDeadline(...args),
  };
});

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: () => mockGetUser(),
      getSession: () => mockGetSession(),
    },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({
    data: { user: { id: 'user-1' } },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: {
      session: { access_token: 'token-123', user: { id: 'user-1' } },
    },
  });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('vtu-checkout service', () => {
  it('normalizes known mobile network providers before checkout', () => {
    expect(
      normalizeVtuCheckoutPayload({
        amount: 1000,
        networkProvider: 'mtn',
      })
    ).toMatchObject({ networkProvider: MOBILE_TO_KUDA_PROVIDER.mtn });
    expect(
      normalizeVtuCheckoutPayload({
        amount: 1000,
        networkProvider: 'airtel',
      })
    ).toMatchObject({ networkProvider: MOBILE_TO_KUDA_PROVIDER.airtel });
  });

  it('normalizes mixed-case network provider keys', () => {
    expect(
      normalizeVtuCheckoutPayload({ amount: 1000, networkProvider: 'MTN' })
    ).toMatchObject({ networkProvider: MOBILE_TO_KUDA_PROVIDER.mtn });
    expect(
      normalizeVtuCheckoutPayload({ amount: 1000, networkProvider: 'AirTel' })
    ).toMatchObject({ networkProvider: MOBILE_TO_KUDA_PROVIDER.airtel });
  });

  it('keeps missing, empty, and unknown network providers unchanged', () => {
    expect(normalizeVtuCheckoutPayload({ amount: 1000 })).not.toHaveProperty(
      'networkProvider'
    );
    expect(
      normalizeVtuCheckoutPayload({ amount: 1000, networkProvider: '' })
    ).toMatchObject({ networkProvider: '' });
    expect(
      normalizeVtuCheckoutPayload({ amount: 1000, networkProvider: 'unknown' })
    ).toMatchObject({ networkProvider: 'unknown' });
  });

  it('confirms a successful VTU checkout', async () => {
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: {
        success: true,
        status: 'SUCCESSFUL',
        reference: 'VTU-123',
        amount: 1000,
      },
      response: { ok: true, headers: { get: () => null } },
    });

    const result = await confirmVtuCheckout({
      gateway: 'paystack',
      reference: 'VTU-123',
    });

    expect(result.status).toBe('successful');
  });

  it('throws a clear error for non-string confirmation status', async () => {
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: {
        reference: 'VTU-123',
        status: 123,
      },
      response: { ok: true, headers: { get: () => null } },
    });

    await expect(
      confirmVtuCheckout({
        gateway: 'paystack',
        reference: 'VTU-123',
      })
    ).rejects.toThrow('Unexpected VTU checkout status: 123');
  });

  it('throws a clear error for unexpected checkout statuses', async () => {
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: {
        reference: 'VTU-123',
        status: 'failed',
      },
      response: { ok: true, headers: { get: () => null } },
    });

    await expect(
      confirmVtuCheckout({
        gateway: 'paystack',
        reference: 'VTU-123',
      })
    ).rejects.toThrow('Unexpected VTU checkout status: failed');
  });

  it('treats a not-yet-successful gateway confirmation as processing', async () => {
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: {
        error: 'Payment is not yet successful',
        status: 'pending',
      },
      response: { ok: false, status: 409, headers: { get: () => null } },
    });

    const result = await confirmVtuCheckout({
      gateway: 'paystack',
      reference: 'VTU-123',
    });

    expect(result).toMatchObject({
      reference: 'VTU-123',
      status: 'processing',
    });
  });

  it('throws a typed processing error instead of a payment failure after polling', async () => {
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: {
        reference: 'VTU-123',
        status: 'processing',
      },
      response: { ok: true, headers: { get: () => null } },
    });

    await expect(
      waitForVtuConfirmation({
        gateway: 'paystack',
        maxAttempts: 1,
        reference: 'VTU-123',
      })
    ).rejects.toBeInstanceOf(VtuPaymentStillProcessingError);
  });

  it('does not wait after the final polling attempt', async () => {
    jest.useFakeTimers();
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: {
        reference: 'VTU-123',
        status: 'processing',
      },
      response: { ok: true, headers: { get: () => null } },
    });

    try {
      const confirmation = expect(
        waitForVtuConfirmation({
          gateway: 'paystack',
          maxAttempts: 1,
          reference: 'VTU-123',
        })
      ).rejects.toBeInstanceOf(VtuPaymentStillProcessingError);

      await jest.runOnlyPendingTimersAsync();

      await confirmation;
      // Only the 30s auth-acquisition bound (Codex R96 P2) may arm a
      // timer — no inter-attempt poll delay after the final attempt.
      const pollDelays = setTimeoutSpy.mock.calls.filter(
        ([, timeoutMs]) => timeoutMs !== 30_000
      );
      expect(pollDelays).toEqual([]);
    } finally {
      setTimeoutSpy.mockRestore();
    }
  });

  it('lists saved cards for the current storefront', async () => {
    mockFetchWithTimeout.mockResolvedValue({
      ok: true,
      json: async () => ({
        cards: [
          {
            id: 'card-1',
            provider: 'paystack',
            label: 'Access Bank ending 1234',
            brand: 'visa',
            bank: 'Access Bank',
            last4: '1234',
            exp_month: '08',
            exp_year: '2030',
            is_default: true,
          },
        ],
      }),
    });

    const result = await listSavedVtuCards();

    expect(result[0]?.label).toBe('Access Bank ending 1234');
  });

  it('chargeWalletForVtu: posts to wallet-only with the caller-supplied Idempotency-Key header', async () => {
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: {
        status: 'successful',
        reference: 'VTU-456',
        amount: 1000,
      },
      response: { ok: true, headers: { get: () => null } },
    });

    // Caller-supplied UUID — the contract change. The form
    // controller holds this key in a ref so a network failure
    // doesn't lose it; chargeWalletForVtu also adopts the
    // server's canonical key when the response carries the join
    // wire (uniform across outcomes — never a per-path concern).
    const idempotencyKey = '11111111-2222-3333-4444-555555555555';
    const result = await chargeWalletForVtu({
      amount: 1000,
      networkProvider: 'mtn',
      phoneNumber: '08012345678',
      type: 'airtime',
      walletAmount: 1000,
      idempotencyKey,
      expectedUserId: 'user-1',
    });

    expect(result).toMatchObject({
      status: 'successful',
      reference: 'VTU-456',
    });
    const [url, init] = mockFetchJsonWithDeadline.mock.calls[0] ?? [];
    expect(url).toBe(VTU_CHECKOUT_WALLET_ONLY_URL);
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe(idempotencyKey);
    const body = parseMockRequestBody();
    expect(body).toMatchObject({
      walletAmount: 1000,
      amount: 1000,
    });
    // The key MUST stay in the header, NOT be sent as a request
    // body field — leaking it into the body would defeat the
    // schema's parsed shape and could expose the key in logs.
    expect(body).not.toHaveProperty('idempotencyKey');
  });

  it('chargeWalletForVtu: reads headers and body under one shared deadline', async () => {
    // Codex R77 6sNGOy: a stalled body must abort like stalled
    // headers instead of hanging the submitting guard forever.
    // (Expiry behavior itself is proven in @baci/shared's
    // fetch-with-timeout suite; this pins the charge path onto it.)
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: {
        status: 'successful',
        reference: 'VTU-456',
        amount: 1000,
      },
      response: { ok: true, headers: { get: () => null } },
    });

    const before = Date.now();
    await chargeWalletForVtu({
      amount: 1000,
      networkProvider: 'mtn',
      phoneNumber: '08012345678',
      type: 'airtime',
      walletAmount: 1000,
      idempotencyKey: '11111111-2222-3333-4444-555555555555',
      expectedUserId: 'user-1',
    });

    const [, init] = mockFetchJsonWithDeadline.mock.calls[0] ?? [];
    const deadlineMs = (init as { deadlineMs: number }).deadlineMs;
    expect(deadlineMs).toBeGreaterThanOrEqual(before + DEFAULT_TIMEOUT);
    expect(deadlineMs).toBeLessThanOrEqual(Date.now() + DEFAULT_TIMEOUT);
  });

  it('chargeWalletForVtu: proceeds when the token belongs to the captured user', async () => {
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: {
        status: 'successful',
        reference: 'VTU-456',
        amount: 1000,
      },
      response: { ok: true, headers: { get: () => null } },
    });

    const result = await chargeWalletForVtu({
      amount: 1000,
      networkProvider: 'mtn',
      phoneNumber: '08012345678',
      type: 'airtime',
      walletAmount: 1000,
      idempotencyKey: '11111111-2222-3333-4444-555555555555',
      expectedUserId: 'user-1',
    });

    expect(result).toMatchObject({ status: 'successful' });
    expect(parseMockRequestBody()).toMatchObject({ expectedUserId: 'user-1' });
  });

  it('chargeWalletForVtu: aborts pre-POST when the binding is uncaptured (hydration gap)', async () => {
    // Session user exists but the store hadn't hydrated the id at
    // submit: posting unbound would skip the server-side
    // account-change guard. Abort instead (key untouched — no HTTP
    // status — so the retry replays once hydration lands).
    await expect(
      chargeWalletForVtu({
        amount: 1000,
        networkProvider: 'mtn',
        phoneNumber: '08012345678',
        type: 'airtime',
        walletAmount: 1000,
        idempotencyKey: '11111111-2222-3333-4444-555555555555',
      })
    ).rejects.toThrow('Account still loading. Please try again.');
    expect(mockFetchJsonWithDeadline).not.toHaveBeenCalled();
  });

  it('chargeWalletForVtu: aborts before any POST when the token belongs to another user', async () => {
    // getUser validated user-1, but the account switched before
    // getSession: the token in hand is user-2's. Debit would land on
    // the wrong wallet, so fail closed without dispatching.
    mockGetSession.mockResolvedValue({
      data: {
        session: { access_token: 'token-user-2', user: { id: 'user-2' } },
      },
    });

    await expect(
      chargeWalletForVtu({
        amount: 1000,
        networkProvider: 'mtn',
        phoneNumber: '08012345678',
        type: 'airtime',
        walletAmount: 1000,
        idempotencyKey: '11111111-2222-3333-4444-555555555555',
        expectedUserId: 'user-1',
      })
    ).rejects.toThrow('Account changed during checkout. Please try again.');
    expect(mockFetchJsonWithDeadline).not.toHaveBeenCalled();
  });
});

describe('shouldRotateWalletIdempotencyKeyForError', () => {
  // The contract: keep the key (return false) for any failure that
  // could leave server state in flight; only rotate (return true) on
  // definitive route 4xx responses whose outcome the server recorded
  // under this key.

  it('returns true for definitive route 4xx (outcome recorded, key is dead)', () => {
    expect(
      shouldRotateWalletIdempotencyKeyForError(new HttpError(400, 'bad'))
    ).toBe(true);
    expect(
      shouldRotateWalletIdempotencyKeyForError(new HttpError(404, 'missing'))
    ).toBe(true);
    expect(
      shouldRotateWalletIdempotencyKeyForError(new HttpError(409, 'collision'))
    ).toBe(true);
    expect(
      shouldRotateWalletIdempotencyKeyForError(new HttpError(422, 'invalid'))
    ).toBe(true);
  });

  it('returns false for pre-route 401/403/413/415/429 — handler never ran', () => {
    // A 429 retry of an already-committed attempt must keep the key:
    // rotating would mint a fresh key and debit a second transaction.
    for (const status of [401, 403, 413, 415, 429]) {
      expect(
        shouldRotateWalletIdempotencyKeyForError(
          new HttpError(status, 'pre-route')
        )
      ).toBe(false);
    }
  });

  it('returns false for HTTP 5xx — server may have persisted partial state', () => {
    expect(
      shouldRotateWalletIdempotencyKeyForError(new HttpError(500, 'oops'))
    ).toBe(false);
    expect(
      shouldRotateWalletIdempotencyKeyForError(new HttpError(502, 'gateway'))
    ).toBe(false);
    expect(
      shouldRotateWalletIdempotencyKeyForError(new HttpError(503, 'unavail'))
    ).toBe(false);
    expect(
      shouldRotateWalletIdempotencyKeyForError(new HttpError(504, 'timeout'))
    ).toBe(false);
  });

  it('returns false for network errors — request may not have reached the server', () => {
    expect(
      shouldRotateWalletIdempotencyKeyForError(new NetworkError('offline'))
    ).toBe(false);
  });

  it('returns false for timeout errors — request status is unknown', () => {
    expect(
      shouldRotateWalletIdempotencyKeyForError(new TimeoutError(30000))
    ).toBe(false);
  });

  it('returns false for unknown / non-HTTP errors — fail safe by keeping the key', () => {
    expect(
      shouldRotateWalletIdempotencyKeyForError(new Error('parse failed'))
    ).toBe(false);
    expect(shouldRotateWalletIdempotencyKeyForError('bare string')).toBe(false);
    expect(shouldRotateWalletIdempotencyKeyForError(undefined)).toBe(false);
    expect(shouldRotateWalletIdempotencyKeyForError(null)).toBe(false);
  });

  it('chargeWalletForVtu: adopts the canonical key after an intent-claim join', async () => {
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('desc-join-ok', 'key-minted');
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: { status: 'successful', reference: 'VTU-456', amount: 1000 },
      response: {
        ok: true,
        headers: {
          get: (name: string) =>
            name === 'X-Vtu-Canonical-Idempotency-Key' ? 'key-winner' : null,
        },
      },
    });

    await chargeWalletForVtu({
      amount: 1000,
      networkProvider: 'mtn',
      phoneNumber: '08012345678',
      type: 'airtime',
      walletAmount: 1000,
      idempotencyKey: 'key-minted',
      expectedUserId: 'user-1',
      pendingDescriptor: 'desc-join-ok',
    });

    expect(recallPendingVtuKey('desc-join-ok')).toBe('key-winner');
  });

  it('chargeWalletForVtu: adopts the canonical key before throwing on error joins', async () => {
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('desc-join-err', 'key-minted');
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: { error: 'boom' },
      response: {
        ok: false,
        status: 500,
        headers: {
          get: (name: string) =>
            name === 'X-Vtu-Canonical-Idempotency-Key' ? 'key-winner' : null,
        },
      },
    });

    await expect(
      chargeWalletForVtu({
        amount: 1000,
        networkProvider: 'mtn',
        phoneNumber: '08012345678',
        type: 'airtime',
        walletAmount: 1000,
        idempotencyKey: 'key-minted',
        expectedUserId: 'user-1',
        pendingDescriptor: 'desc-join-err',
      })
    ).rejects.toThrow(HttpError);
    expect(recallPendingVtuKey('desc-join-err')).toBe('key-winner');
  });

  it('chargeWalletForVtu: skips adoption without a descriptor', async () => {
    clearPendingVtuKeys();
    rememberPendingVtuPurchase('desc-no-adopt', 'key-minted');
    mockFetchJsonWithDeadline.mockResolvedValue({
      data: { status: 'successful', reference: 'VTU-456', amount: 1000 },
      response: {
        ok: true,
        headers: { get: () => 'key-winner' },
      },
    });

    await chargeWalletForVtu({
      amount: 1000,
      networkProvider: 'mtn',
      phoneNumber: '08012345678',
      type: 'airtime',
      walletAmount: 1000,
      idempotencyKey: 'key-minted',
      expectedUserId: 'user-1',
    });

    expect(recallPendingVtuKey('desc-no-adopt')).toBe('key-minted');
  });
});

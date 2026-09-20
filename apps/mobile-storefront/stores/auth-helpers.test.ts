/**
 * Tests for auth-helpers — initTimeout, getErrorMessage,
 * shouldInvalidateSessionOnGetUserError, and hydrateCustomer.
 */

// biome-ignore-all lint/correctness/noUndeclaredVariables: Jest globals are provided by jest-expo in this legacy store test.
import type { User } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Mock chain builder (mirrors auth-store.test.ts pattern)
// ---------------------------------------------------------------------------

function makeChain(result: { data: unknown; error: unknown }) {
  const chain: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'update', 'insert']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.maybeSingle = jest.fn(() => Promise.resolve(result));
  chain.single = jest.fn(() => Promise.resolve(result));
  return chain;
}

// ---------------------------------------------------------------------------
// Mocks — must be declared before jest.mock() calls
// ---------------------------------------------------------------------------

const mockFrom = jest.fn();
const mockRpc = jest.fn();

jest.mock('../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

jest.mock('../lib/auth-helpers', () => ({
  splitFullName: jest.fn((name: unknown) => {
    if (!name || typeof name !== 'string')
      return { firstName: '', lastName: '' };
    const parts = (name as string).trim().split(/\s+/);
    return {
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
    };
  }),
}));

jest.mock('../lib/logger', () => ({
  createLogger: () => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

import { hydrateCustomer } from './auth-customer-hydration';
import {
  CUSTOMER_SELECT_COLUMNS,
  LEGACY_CUSTOMER_SELECT_COLUMNS,
} from './auth-customer-schema-compat';
// Import after mocks
import {
  getErrorMessage,
  INIT_QUERY_TIMEOUT_MS,
  initTimeout,
  isInitTimeoutError,
  shouldInvalidateSessionOnGetUserError,
} from './auth-helpers';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const MERCHANT_ID = 'merchant-123';
const USER_ID = 'user-456';

const mockUser: User = {
  id: USER_ID,
  email: 'test@example.com',
  app_metadata: {},
  user_metadata: { full_name: 'Jane Doe' },
  aud: 'authenticated',
  created_at: '2024-01-01T00:00:00Z',
} as User;

const mockCustomerRow = {
  id: '00000000-0000-4000-8000-000000000789',
  email: 'test@example.com',
  first_name: 'Jane',
  last_name: 'Doe',
  phone: null,
  loyalty_points: 100,
};

// ---------------------------------------------------------------------------
// initTimeout
// ---------------------------------------------------------------------------

describe('initTimeout', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('resolves with the value when promise settles before timeout', async () => {
    const result = initTimeout(Promise.resolve('ok'), 'test');
    await jest.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe('ok');
  });

  it('rejects with timeout error when promise does not settle in time', async () => {
    const result = initTimeout(new Promise(() => void 0), 'slowQuery');
    // Attach a catch handler immediately to prevent unhandled rejection
    const rejection = result.catch((e: unknown) => e);
    await jest.advanceTimersByTimeAsync(INIT_QUERY_TIMEOUT_MS + 1);
    const error = await rejection;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(
      `Timeout: slowQuery took longer than ${INIT_QUERY_TIMEOUT_MS}ms`
    );
  });

  it('works with thenables (Supabase query builders)', async () => {
    // Supabase query builders are thenables, not Promises.
    // initTimeout wraps them via Promise.resolve() which handles both.
    const thenable = Promise.resolve('thenable-value');
    const result = initTimeout(thenable, 'thenable');
    await jest.advanceTimersByTimeAsync(0);
    await expect(result).resolves.toBe('thenable-value');
  });

  it('clears the timeout after resolution', async () => {
    const clearSpy = jest.spyOn(globalThis, 'clearTimeout');
    const result = initTimeout(Promise.resolve('done'), 'test');
    await jest.advanceTimersByTimeAsync(0);
    await result;
    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// getErrorMessage
// ---------------------------------------------------------------------------

describe('getErrorMessage', () => {
  it('returns message from Error instances', () => {
    expect(getErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('returns String() for non-Error values', () => {
    expect(getErrorMessage('string error')).toBe('string error');
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});

// ---------------------------------------------------------------------------
// isInitTimeoutError
// ---------------------------------------------------------------------------

describe('isInitTimeoutError', () => {
  it('matches initTimeout errors for the expected label', () => {
    expect(
      isInitTimeoutError(
        new Error(
          `Timeout: getSession took longer than ${INIT_QUERY_TIMEOUT_MS}ms`
        ),
        'getSession'
      )
    ).toBe(true);
  });

  it('rejects non-timeout and mismatched-label errors', () => {
    expect(isInitTimeoutError(new Error('Network request failed'))).toBe(false);
    expect(
      isInitTimeoutError(
        new Error(
          `Timeout: merchant lookup took longer than ${INIT_QUERY_TIMEOUT_MS}ms`
        ),
        'getSession'
      )
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// shouldInvalidateSessionOnGetUserError
// ---------------------------------------------------------------------------

describe('shouldInvalidateSessionOnGetUserError', () => {
  it('returns false for non-object errors', () => {
    expect(shouldInvalidateSessionOnGetUserError(null)).toBe(false);
    expect(shouldInvalidateSessionOnGetUserError('string')).toBe(false);
    expect(shouldInvalidateSessionOnGetUserError(42)).toBe(false);
  });

  it('returns true for 401 status', () => {
    expect(
      shouldInvalidateSessionOnGetUserError({ status: 401, message: '' })
    ).toBe(true);
  });

  it('returns true for 400 and 403 status', () => {
    expect(
      shouldInvalidateSessionOnGetUserError({ status: 400, message: '' })
    ).toBe(true);
    expect(
      shouldInvalidateSessionOnGetUserError({ status: 403, message: '' })
    ).toBe(true);
  });

  it('returns false for 500+ (server errors are transient)', () => {
    expect(
      shouldInvalidateSessionOnGetUserError({ status: 500, message: '' })
    ).toBe(false);
    expect(
      shouldInvalidateSessionOnGetUserError({ status: 502, message: '' })
    ).toBe(false);
  });

  it('returns true for bad_jwt code', () => {
    expect(
      shouldInvalidateSessionOnGetUserError({ code: 'bad_jwt', message: '' })
    ).toBe(true);
  });

  it('returns true for session_not_found code', () => {
    expect(
      shouldInvalidateSessionOnGetUserError({
        code: 'session_not_found',
        message: '',
      })
    ).toBe(true);
  });

  it('returns true for jwt_expired code', () => {
    expect(
      shouldInvalidateSessionOnGetUserError({
        code: 'jwt_expired',
        message: '',
      })
    ).toBe(true);
  });

  it('handles case-insensitive code matching', () => {
    expect(
      shouldInvalidateSessionOnGetUserError({
        code: 'BAD_JWT',
        message: '',
      })
    ).toBe(true);
  });

  it('returns true for messages containing jwt/token keywords', () => {
    expect(
      shouldInvalidateSessionOnGetUserError({ message: 'jwt malformed' })
    ).toBe(true);
    expect(
      shouldInvalidateSessionOnGetUserError({ message: 'session missing here' })
    ).toBe(true);
    expect(
      shouldInvalidateSessionOnGetUserError({ message: 'invalid token found' })
    ).toBe(true);
    expect(
      shouldInvalidateSessionOnGetUserError({ message: 'token expired' })
    ).toBe(true);
  });

  it('returns false for generic error messages', () => {
    expect(
      shouldInvalidateSessionOnGetUserError({
        message: 'network timeout',
      })
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// hydrateCustomer
// ---------------------------------------------------------------------------

describe('hydrateCustomer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: direct customer lookup succeeds
    mockFrom.mockImplementation(() =>
      makeChain({ data: mockCustomerRow, error: null })
    );
    mockRpc.mockReturnValue(Promise.resolve({ data: null, error: null }));
  });

  it('returns validated customer on successful direct lookup', async () => {
    const result = await hydrateCustomer({
      merchantId: MERCHANT_ID,
      user: mockUser,
      useTimeout: false,
    });

    expect(result).toEqual({
      id: mockCustomerRow.id,
      email: mockCustomerRow.email,
      first_name: mockCustomerRow.first_name,
      last_name: mockCustomerRow.last_name,
      phone: undefined,
      loyalty_points: mockCustomerRow.loyalty_points,
    });
  });

  it('retries without username_changed_at when production has the legacy customer schema', async () => {
    const currentSchema = makeChain({
      data: null,
      error: {
        code: '42703',
        message: 'column customers.username_changed_at does not exist',
      },
    });
    const legacySchema = makeChain({ data: mockCustomerRow, error: null });
    mockFrom
      .mockReturnValueOnce(currentSchema)
      .mockReturnValueOnce(legacySchema);

    const result = await hydrateCustomer({
      merchantId: MERCHANT_ID,
      user: mockUser,
      useTimeout: false,
    });

    expect(currentSchema.select).toHaveBeenCalledWith(CUSTOMER_SELECT_COLUMNS);
    expect(legacySchema.select).toHaveBeenCalledWith(
      LEGACY_CUSTOMER_SELECT_COLUMNS
    );
    expect(result?.id).toBe(mockCustomerRow.id);
    expect(result?.username_changed_at).toBeUndefined();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('calls RPC upsert when direct lookup returns no data', async () => {
    // First call (customers lookup) returns null, second call (re-fetch) returns data
    let callCount = 0;
    mockFrom.mockImplementation(() => {
      callCount++;
      if (callCount <= 1) {
        return makeChain({ data: null, error: null });
      }
      return makeChain({ data: mockCustomerRow, error: null });
    });

    mockRpc.mockReturnValue(Promise.resolve({ data: null, error: null }));

    const result = await hydrateCustomer({
      merchantId: MERCHANT_ID,
      user: mockUser,
      useTimeout: false,
    });

    expect(mockRpc).toHaveBeenCalledWith('upsert_customer_on_auth', {
      p_merchant_id: MERCHANT_ID,
      p_user_id: USER_ID,
      p_email: 'test@example.com',
      p_full_name: 'Jane Doe',
      p_phone: null,
    });
    expect(result?.id).toBe(mockCustomerRow.id);
  });

  it('returns null when Zod validation fails', async () => {
    mockFrom.mockImplementation(() =>
      makeChain({ data: { id: 'not-a-uuid', email: 'bad' }, error: null })
    );

    const result = await hydrateCustomer({
      merchantId: MERCHANT_ID,
      user: mockUser,
      useTimeout: false,
    });

    expect(result).toBeNull();
  });

  it('returns null when initGen is stale (cancellation guard)', async () => {
    let currentGen = 1;

    mockFrom.mockImplementation(() => {
      // Simulate generation change during query
      currentGen = 2;
      return makeChain({ data: mockCustomerRow, error: null });
    });

    const result = await hydrateCustomer({
      merchantId: MERCHANT_ID,
      user: mockUser,
      useTimeout: false,
      initGen: 1,
      getInitGen: () => currentGen,
    });

    expect(result).toBeNull();
  });

  it('backfills first_name and last_name from OAuth metadata', async () => {
    const customerWithoutName = {
      ...mockCustomerRow,
      first_name: null,
      last_name: null,
    };

    const updatedCustomer = {
      ...mockCustomerRow,
      first_name: 'Jane',
      last_name: 'Doe',
    };

    let callIndex = 0;
    mockFrom.mockImplementation(() => {
      callIndex++;
      // First call: customer without name. Second call: update returns backfilled.
      if (callIndex === 1) {
        return makeChain({ data: customerWithoutName, error: null });
      }
      return makeChain({ data: updatedCustomer, error: null });
    });

    const result = await hydrateCustomer({
      merchantId: MERCHANT_ID,
      user: mockUser,
      useTimeout: false,
    });

    expect(result?.first_name).toBe('Jane');
    expect(result?.last_name).toBe('Doe');
  });

  it('handles fetch error gracefully and returns null', async () => {
    mockFrom.mockImplementation(() =>
      makeChain({
        data: null,
        error: { message: 'Network error' },
      })
    );

    // User has no email, so RPC path is skipped
    const userNoEmail = { ...mockUser, email: undefined } as unknown as User;

    const result = await hydrateCustomer({
      merchantId: MERCHANT_ID,
      user: userNoEmail,
      useTimeout: false,
    });

    expect(result).toBeNull();
  });
});

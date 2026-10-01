import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { AuthSessionMissingError } from '@supabase/supabase-js';
import type { getNegotiationCustomerContact as GetNegotiationCustomerContact } from './negotiation-customer-auth';

type AuthUserResponse = {
  data: {
    user: { email?: string; id: string; phone?: string | null } | null;
  };
  error?: unknown | null;
};

const mockGetUser = jest.fn<() => Promise<AuthUserResponse>>();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getUser: mockGetUser,
    },
  },
}));

let getNegotiationCustomerContact: typeof GetNegotiationCustomerContact;

beforeAll(async () => {
  ({ getNegotiationCustomerContact } = await import(
    './negotiation-customer-auth'
  ));
});

describe('getNegotiationCustomerContact', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });
  });

  it('allows a guest when Supabase reports a missing session', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });

    await expect(
      getNegotiationCustomerContact('0803 123 4567')
    ).resolves.toEqual({
      errorMessage: null,
      normalizedEmail: null,
      normalizedPhone: '2348031234567',
      userId: null,
    });
  });

  it('propagates unexpected authentication errors', async () => {
    const error = new Error('auth unavailable');
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error,
    });

    await expect(getNegotiationCustomerContact('0803 123 4567')).rejects.toBe(
      error
    );
  });

  it('persists the authenticated account email when phone is empty', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { email: 'buyer@example.com', id: 'customer-1' } },
      error: null,
    });

    await expect(getNegotiationCustomerContact('')).resolves.toEqual({
      errorMessage: null,
      normalizedEmail: 'buyer@example.com',
      normalizedPhone: null,
      userId: 'customer-1',
    });
  });
});

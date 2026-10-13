import { AuthSessionMissingError } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import {
  type NegotiationCustomerClient,
  resolveNegotiationCustomer,
} from './negotiation-modal-customer';

function createClientStub(
  getUser: NegotiationCustomerClient['auth']['getUser']
): NegotiationCustomerClient {
  return { auth: { getUser } };
}

describe('resolveNegotiationCustomer', () => {
  it('normalizes email and preserves a non-Nigerian account phone', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: {
        user: {
          email: ' Buyer@Example.COM ',
          id: 'customer-1',
          phone: '15551234567',
        },
      },
      error: null,
    });

    await expect(
      resolveNegotiationCustomer(createClientStub(getUser))
    ).resolves.toEqual({
      customerEmail: 'buyer@example.com',
      customerId: 'customer-1',
      customerPhone: '15551234567',
    });
  });

  it('returns a guest session when Supabase reports no auth session', async () => {
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error: new AuthSessionMissingError(),
    });

    await expect(
      resolveNegotiationCustomer(createClientStub(getUser))
    ).resolves.toEqual({
      customerEmail: null,
      customerId: null,
      customerPhone: null,
    });
  });

  it('propagates unexpected authentication failures', async () => {
    const error = new Error('auth unavailable');
    const getUser = vi.fn().mockResolvedValue({
      data: { user: null },
      error,
    });

    await expect(
      resolveNegotiationCustomer(createClientStub(getUser))
    ).rejects.toBe(error);
  });
});

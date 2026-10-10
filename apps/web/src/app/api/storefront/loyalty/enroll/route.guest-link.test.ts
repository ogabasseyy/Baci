import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_ID,
  createRequest,
  MERCHANT_ID,
  mockOwnedCustomer,
  enrollMocks as mocks,
  POST,
} from './route.test-helpers';

function mockGuestLogin(emailConfirmedAt: string | null) {
  mocks.mockGetUser.mockResolvedValue({
    data: {
      user: {
        id: 'new-login-id',
        email: 'guest@example.com',
        email_confirmed_at: emailConfirmedAt,
      },
    },
  });
}

describe('POST /api/storefront/loyalty/enroll guest linkage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOwnedCustomer();
  });

  it('returns 409 when the caller owns an unlinked guest row', async () => {
    mockGuestLogin('2026-10-09T00:00:00.000Z');
    mocks.mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { id: CUSTOMER_ID },
        error: null,
      });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error:
        'Customer account is not linked to this login. Sign in again to link it, then retry enrollment.',
    });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 404 for an unverified email instead of the link hint', async () => {
    mockGuestLogin(null);
    mocks.mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Customer not found for this merchant' });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });

  it('returns 404 when the guest row is not the requested customer', async () => {
    mockGuestLogin('2026-10-09T00:00:00.000Z');
    mocks.mockMaybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { id: 'other-customer-id' },
        error: null,
      });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Customer not found for this merchant' });
    expect(mocks.mockRpc).not.toHaveBeenCalled();
  });
});

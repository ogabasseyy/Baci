import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CUSTOMER_ID,
  createRequest,
  MERCHANT_ID,
  mockSession,
  enrollMocks as mocks,
  POST,
} from './route.test-helpers';

// The re-link hint is evaluated inside enroll_customer_loyalty with the
// definer's rights (shoppers cannot read unlinked rows under RLS), so
// these tests pin the route's mapping only. The email-match, casing,
// and verified-email rules live in the SQL suite (cases 3c-3e).
describe('POST /api/storefront/loyalty/enroll guest linkage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSession();
  });

  it('returns 409 with the re-link message when the RPC reports guest_link_required', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'guest_link_required' },
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
  });

  it('returns 404 when the RPC reports customer_not_found for an unlinked row', async () => {
    mocks.mockRpc.mockResolvedValue({
      data: { success: false, error: 'customer_not_found' },
      error: null,
    });

    const response = await POST(
      createRequest({ merchant_id: MERCHANT_ID, customer_id: CUSTOMER_ID })
    );
    const body = await response.json();

    expect(mocks.mockRpc).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
    expect(body).toEqual({ error: 'Customer not found for this merchant' });
  });
});

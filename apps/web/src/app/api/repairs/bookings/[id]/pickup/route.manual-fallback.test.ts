import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import {
  authorizedPickupRequest,
  manualPickupClient,
  manualPickupClientFailure,
  pickupRouteParams,
  pickupRouteRequest,
} from './route.test-support';

const mocks = vi.hoisted(() => ({
  authorizeRepairsRequest: vi.fn(),
  createClient: vi.fn(),
  bookRepairPickup: vi.fn(),
}));

vi.mock('@/lib/repairs/catalog-admin-auth', () => ({
  authorizeRepairsRequest: mocks.authorizeRepairsRequest,
}));

vi.mock('@/lib/supabase/admin', () => ({
  createClient: mocks.createClient,
}));

vi.mock('@/lib/repairs/book-repair-pickup', () => ({
  bookRepairPickup: mocks.bookRepairPickup,
}));

describe('POST /api/repairs/bookings/[id]/pickup manual fallback conflicts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRepairsRequest.mockResolvedValue(authorizedPickupRequest());
    mocks.createClient.mockReturnValue({});
  });

  it('bug fix: returns 409 when manual fallback races a linked shipment', async () => {
    mocks.authorizeRepairsRequest.mockResolvedValueOnce(
      authorizedPickupRequest(
        manualPickupClient(true, {
          shipment_id: '00000000-0000-4000-8000-000000000099',
        })
      )
    );
    const res = await POST(pickupRouteRequest({ mode: 'manual' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(409);
    expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
  });

  it('bug fix: returns 409 when an automatic booking lock is still active', async () => {
    mocks.authorizeRepairsRequest.mockResolvedValueOnce(
      authorizedPickupRequest(
        manualPickupClient(true, {
          pickup_booking_lock_token: 'lock-token',
          pickup_booking_started_at: new Date().toISOString(),
        })
      )
    );
    const res = await POST(pickupRouteRequest({ mode: 'manual' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 when marking pickup manual on a missing booking', async () => {
    mocks.authorizeRepairsRequest.mockResolvedValueOnce(
      authorizedPickupRequest(manualPickupClient(false))
    );
    const res = await POST(pickupRouteRequest({ mode: 'manual' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(404);
  });

  it('returns 500 when the manual booking lookup fails', async () => {
    mocks.authorizeRepairsRequest.mockResolvedValueOnce(
      authorizedPickupRequest(manualPickupClientFailure('lookup'))
    );
    const res = await POST(pickupRouteRequest({ mode: 'manual' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(500);
  });

  it('returns 500 when the manual note write fails', async () => {
    mocks.authorizeRepairsRequest.mockResolvedValueOnce(
      authorizedPickupRequest(manualPickupClientFailure('update'))
    );
    const res = await POST(pickupRouteRequest({ mode: 'manual' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(500);
  });
});

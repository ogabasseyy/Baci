import { NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import {
  authorizedPickupRequest,
  manualPickupClient,
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

describe('POST /api/repairs/bookings/[id]/pickup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authorizeRepairsRequest.mockResolvedValue(authorizedPickupRequest());
    mocks.createClient.mockReturnValue({});
  });

  it('returns 401 when unauthorized', async () => {
    mocks.authorizeRepairsRequest.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await POST(pickupRouteRequest({ mode: 'auto' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(401);
  });

  it('books a courier pickup and returns the result', async () => {
    mocks.bookRepairPickup.mockResolvedValueOnce({
      ok: true,
      trackingNumber: 'TRK-1',
      carrierName: 'GIG Logistics',
      shipmentId: 'ship-1',
      pickupScheduledAt: null,
    });
    const res = await POST(pickupRouteRequest({ mode: 'auto' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toMatchObject({ ok: true, trackingNumber: 'TRK-1' });
    expect(mocks.createClient).toHaveBeenCalled();
  });

  it('returns 400 for a malformed JSON body instead of booking a pickup', async () => {
    const res = await POST(
      new Request('https://s.example/api/repairs/bookings/x/pickup', {
        method: 'POST',
        body: '{ not valid json',
      }) as never,
      { params: pickupRouteParams }
    );
    expect(res.status).toBe(400);
    expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
  });

  it('returns 200 with a recoverable failure the UI can show', async () => {
    mocks.bookRepairPickup.mockResolvedValueOnce({
      ok: false,
      reason: 'gigl_unavailable',
      message: 'No coverage',
      canRetryManually: true,
    });
    const res = await POST(pickupRouteRequest({ mode: 'auto' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result).toMatchObject({ ok: false, canRetryManually: true });
  });

  it('maps a missing booking to 404', async () => {
    mocks.bookRepairPickup.mockResolvedValueOnce({
      ok: false,
      reason: 'not_found',
      message: 'Repair booking not found.',
      canRetryManually: false,
    });
    const res = await POST(pickupRouteRequest({ mode: 'auto' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(404);
  });

  it('records a manual pickup arrangement without calling the courier', async () => {
    const client = manualPickupClient(true);
    mocks.authorizeRepairsRequest.mockResolvedValueOnce(
      authorizedPickupRequest(client)
    );
    const res = await POST(pickupRouteRequest({ mode: 'manual' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, manual: true });
    expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(client.update).toHaveBeenCalledWith(
      expect.objectContaining({
        pickup_payment_status: 'manual_fulfilled',
        pickup_booking_lock_token: null,
        pickup_booking_started_at: null,
      })
    );
  });

  it('bugfix: uses the authenticated RLS client for manual fulfillment writes', async () => {
    const client = manualPickupClient(true);
    mocks.authorizeRepairsRequest.mockResolvedValueOnce(
      authorizedPickupRequest(client)
    );
    await POST(pickupRouteRequest({ mode: 'manual' }) as never, {
      params: pickupRouteParams,
    });
    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(client.updateEqCalls).toContainEqual(['service_type', 'pickup']);
  });

  it('bugfix: does not mark drop-off repairs as manual pickup fulfilled', async () => {
    const client = manualPickupClient(true, { service_type: 'dropoff' });
    mocks.authorizeRepairsRequest.mockResolvedValueOnce(
      authorizedPickupRequest(client)
    );
    const res = await POST(pickupRouteRequest({ mode: 'manual' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(404);
    expect(client.update).not.toHaveBeenCalled();
  });

  it('bugfix: allows grandfathered null pickup_payment_status through the manual filter', async () => {
    const client = manualPickupClient(true);
    mocks.authorizeRepairsRequest.mockResolvedValueOnce(
      authorizedPickupRequest(client)
    );
    const res = await POST(pickupRouteRequest({ mode: 'manual' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(200);
    expect(client.orCalls[0]).toContain('pickup_payment_status.is.null');
    expect(client.orCalls[0]).toContain('pickup_payment_status.neq.booked');
    expect(client.orCalls[0]).toContain(
      'pickup_payment_status.neq.manual_fulfilled'
    );
  });

  it('returns 400 for a non-uuid booking id', async () => {
    const res = await POST(pickupRouteRequest({ mode: 'auto' }) as never, {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });
    expect(res.status).toBe(400);
    expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid pickup mode', async () => {
    const res = await POST(pickupRouteRequest({ mode: 'teleport' }) as never, {
      params: pickupRouteParams,
    });
    expect(res.status).toBe(400);
    expect(mocks.bookRepairPickup).not.toHaveBeenCalled();
  });
});

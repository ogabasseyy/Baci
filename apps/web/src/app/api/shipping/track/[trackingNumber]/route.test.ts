import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  maybeNotifyActivateProtection: vi.fn(),
  shipmentMaybeSingle: vi.fn(),
  shipmentUpdate: vi.fn(),
  trackShipment: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => new Map()),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(() => ({ from: mocks.from })),
}));

vi.mock('@/lib/supabase/admin', () => {
  throw new Error(
    'shipping tracking route must not import the service-role client'
  );
});

vi.mock('@/lib/insurance/notify-activate-protection', () => ({
  maybeNotifyActivateProtection: (...args: unknown[]) =>
    mocks.maybeNotifyActivateProtection(...args),
}));

vi.mock('@/lib/shipping', () => ({
  shippingService: {
    trackShipment: (...args: unknown[]) => mocks.trackShipment(...args),
  },
}));

import { POST } from './route';

const TRACKING_NUMBER = 'GIGL-REPAIR-1';

function arrangeOrderlessRepairShipment() {
  let shipmentCallCount = 0;
  const shipmentSelect = vi.fn().mockReturnValue({
    maybeSingle: mocks.shipmentMaybeSingle,
  });
  const shipmentEq = vi.fn().mockReturnValue({ select: shipmentSelect });
  mocks.shipmentUpdate.mockReturnValue({ eq: shipmentEq });

  mocks.from.mockImplementation((table: string) => {
    if (table === 'orders') {
      throw new Error('Orderless repair tracking must not update an order');
    }
    if (table !== 'shipments') {
      throw new Error(`Unexpected tracking table: ${table}`);
    }

    shipmentCallCount += 1;
    if (shipmentCallCount === 1) {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                carrier_name: 'GIG Logistics',
                estimated_delivery_days: 3,
                id: 'repair-shipment-1',
                order_id: null,
                provider: 'GIGL',
                receiver_address: { city: 'Ikeja', state: 'Lagos' },
              },
            }),
          }),
        }),
      };
    }

    return { update: mocks.shipmentUpdate };
  });
}

describe('GIGL repair pickup shipment tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.shipmentMaybeSingle.mockResolvedValue({
      data: { id: 'repair-shipment-1' },
      error: null,
    });
    mocks.trackShipment.mockResolvedValue({
      actualDelivery: new Date('2026-09-01T15:00:00.000Z'),
      carrierName: 'GIG Logistics',
      estimatedDelivery: undefined,
      events: [
        {
          description: 'Delivered to repair centre',
          location: 'Ikeja',
          status: 'delivered',
          timestamp: new Date('2026-09-01T15:00:00.000Z'),
        },
      ],
      provider: 'GIGL',
      status: 'delivered',
    });
  });

  it('persists a GIGL repair snapshot without order-only side effects', async () => {
    arrangeOrderlessRepairShipment();

    const response = await POST(
      new NextRequest(
        `http://localhost/api/shipping/track/${TRACKING_NUMBER}`,
        {
          headers: {
            Cookie: 'csrf-token=test-csrf-token',
            'x-csrf-token': 'test-csrf-token',
          },
          method: 'POST',
        }
      ),
      { params: Promise.resolve({ trackingNumber: TRACKING_NUMBER }) }
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.trackShipment).toHaveBeenCalledWith(TRACKING_NUMBER, 'GIGL');
    expect(mocks.shipmentUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'delivered' })
    );
    expect(mocks.from).not.toHaveBeenCalledWith('orders');
    expect(mocks.maybeNotifyActivateProtection).not.toHaveBeenCalled();
    expect(body).toMatchObject({
      shipment: { id: 'repair-shipment-1', orderId: null },
      status: 'delivered',
      trackingNumber: TRACKING_NUMBER,
    });
  });
});

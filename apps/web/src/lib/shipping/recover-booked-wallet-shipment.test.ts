import { describe, expect, it, vi } from 'vitest';
import { OrderShipmentBookingError } from './order-shipment-booking-utils';
import { recoverBookedWalletShipment } from './recover-booked-wallet-shipment';

function createSupabase(options: {
  charge?: { data: { shipment_id: string | null } | null; error: unknown };
  shipment?: { data: Record<string, unknown> | null; error: unknown };
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'merchant_shipping_charges') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue(
            options.charge ?? {
              data: { shipment_id: 'ship-1' },
              error: null,
            }
          ),
        };
      }
      if (table === 'shipments') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue(
            options.shipment ?? {
              data: {
                id: 'ship-1',
                provider: 'GIGL',
                provider_shipment_id: 'p1',
                shipping_quote_id: 'q1',
                tracking_number: 't1',
                carrier_name: 'GIGL',
                estimated_delivery_days: 2,
                label_url: null,
                pickup_scheduled_at: null,
                status: 'booked',
              },
              error: null,
            }
          ),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    }),
  };
}

const charge = {
  chargeId: 'c1',
  chargedAmount: 100,
  balanceAfter: 0,
  status: 'booked',
};

describe('recoverBookedWalletShipment', () => {
  it('returns the shipment persisted on a booked wallet charge', async () => {
    await expect(
      recoverBookedWalletShipment(
        createSupabase({}) as never,
        'm1',
        'o1',
        charge
      )
    ).resolves.toMatchObject({
      shipmentId: 'ship-1',
      trackingNumber: 't1',
    });
  });

  it('does not invent a provider booking when the charge has no shipment', async () => {
    await expect(
      recoverBookedWalletShipment(
        createSupabase({
          charge: { data: { shipment_id: null }, error: null },
        }) as never,
        'm1',
        'o1',
        charge
      )
    ).rejects.toMatchObject({
      code: 'MERCHANT_WALLET_BOOKED_SHIPMENT_MISSING',
    });
  });

  it('does not invent a provider booking when the saved shipment is incomplete', async () => {
    await expect(
      recoverBookedWalletShipment(
        createSupabase({
          shipment: {
            data: {
              id: 'ship-1',
              provider: 'GIGL',
              provider_shipment_id: null,
              tracking_number: 't1',
              carrier_name: 'GIGL',
              status: 'booked',
            },
            error: null,
          },
        }) as never,
        'm1',
        'o1',
        charge
      )
    ).rejects.toMatchObject({
      code: 'MERCHANT_WALLET_BOOKED_SHIPMENT_MISSING',
    });
  });

  it('surfaces charge lookup failures as an existing-shipment lookup error', async () => {
    await expect(
      recoverBookedWalletShipment(
        createSupabase({
          charge: { data: null, error: { message: 'db down' } },
        }) as never,
        'm1',
        'o1',
        charge
      )
    ).rejects.toBeInstanceOf(OrderShipmentBookingError);
  });
});

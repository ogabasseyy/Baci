// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  notifyRepairBooking: vi.fn().mockResolvedValue(undefined),
  from: vi.fn(),
}));

vi.mock('@/lib/repair-notifications', () => ({
  notifyRepairBooking: (...args: unknown[]) =>
    mocks.notifyRepairBooking(...args),
}));

import { notifyRepairPickupBookingAfterPayment } from './notify-repair-pickup-booking';

const merchantId = '123e4567-e89b-12d3-a456-426614174000';
const repairId = '223e4567-e89b-12d3-a456-426614174000';

function buildSupabase(result: { data: unknown; error: unknown }) {
  const chain = {
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    select: vi.fn(() => chain),
  };
  mocks.from.mockReturnValue(chain);
  return { from: mocks.from } as never;
}

describe('notifyRepairPickupBookingAfterPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notifies merchant and customer after a paid pickup is booked', async () => {
    const supabase = buildSupabase({
      data: {
        ticket_number: 42,
        customer_name: 'Ada Lovelace',
        customer_email: 'ada@example.com',
        device_type: 'Smartphone',
        device_model: 'iPhone 15',
        pickup_address: '12 Station Road, Osogbo, Osun, Nigeria',
        quote_id: null,
      },
      error: null,
    });

    await notifyRepairPickupBookingAfterPayment(supabase, merchantId, repairId);

    expect(mocks.notifyRepairBooking).toHaveBeenCalledWith({
      customerEmail: 'ada@example.com',
      customerName: 'Ada Lovelace',
      deviceModel: 'iPhone 15',
      deviceType: 'Smartphone',
      merchantId,
      pickupAddress: '12 Station Road, Osogbo, Osun, Nigeria',
      quoteId: null,
      repairId,
      serviceType: 'pickup',
      ticketNumber: 42,
    });
  });

  it('skips notify when the repair snapshot is incomplete', async () => {
    const supabase = buildSupabase({
      data: {
        ticket_number: null,
        customer_name: 'Ada Lovelace',
        customer_email: 'ada@example.com',
        device_type: 'Smartphone',
        device_model: 'iPhone 15',
        pickup_address: null,
        quote_id: null,
      },
      error: null,
    });

    await notifyRepairPickupBookingAfterPayment(supabase, merchantId, repairId);

    expect(mocks.notifyRepairBooking).not.toHaveBeenCalled();
  });

  it('skips notify when the repair lookup errors', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = buildSupabase({
      data: null,
      error: { message: 'db down' },
    });

    try {
      await notifyRepairPickupBookingAfterPayment(
        supabase,
        merchantId,
        repairId
      );
      expect(mocks.notifyRepairBooking).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('skips notify when the repair row is missing', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const supabase = buildSupabase({ data: null, error: null });

    try {
      await notifyRepairPickupBookingAfterPayment(
        supabase,
        merchantId,
        repairId
      );
      expect(mocks.notifyRepairBooking).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  abandonUnlinkedRepairPickupShipment: vi.fn(),
  releaseRepairPickupBookingClaim: vi.fn(),
}));

vi.mock('@/lib/repairs/abandon-unlinked-repair-pickup-shipment', () => ({
  abandonUnlinkedRepairPickupShipment:
    mocks.abandonUnlinkedRepairPickupShipment,
}));
vi.mock('@/lib/repairs/release-repair-pickup-booking-claim', () => ({
  releaseRepairPickupBookingClaim: mocks.releaseRepairPickupBookingClaim,
}));

import { releaseUnlinkedRepairPickupReservation } from './release-unlinked-repair-pickup-reservation';

describe('releaseUnlinkedRepairPickupReservation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('releases the claim only after orphan cleanup succeeds', async () => {
    mocks.abandonUnlinkedRepairPickupShipment.mockResolvedValueOnce(true);
    mocks.releaseRepairPickupBookingClaim.mockResolvedValueOnce(true);

    const result = await releaseUnlinkedRepairPickupReservation(
      {} as never,
      'merchant-1',
      'repair-1',
      'ship-1',
      'lock-1'
    );

    expect(result).toBe('booking_failed');
    expect(mocks.abandonUnlinkedRepairPickupShipment).toHaveBeenCalledWith(
      {},
      'merchant-1',
      'ship-1'
    );
    expect(mocks.releaseRepairPickupBookingClaim).toHaveBeenCalledWith(
      {},
      'merchant-1',
      'repair-1',
      'lock-1'
    );
  });

  it('retains the booking claim when orphan cleanup fails', async () => {
    mocks.abandonUnlinkedRepairPickupShipment.mockResolvedValueOnce(false);

    const result = await releaseUnlinkedRepairPickupReservation(
      {} as never,
      'merchant-1',
      'repair-1',
      'ship-1',
      'lock-1'
    );

    expect(result).toBe('shipment_save_failed');
    expect(mocks.releaseRepairPickupBookingClaim).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createRepair } from './repair';
import { validRepairInput } from './repair.test-fixtures';

const mocks = vi.hoisted(() => ({
  createRepairBooking: vi.fn(),
  notifyRepairBooking: vi.fn(),
}));

vi.mock('@/lib/repairs/create-repair-core', () => ({
  createRepairBooking: mocks.createRepairBooking,
}));

vi.mock('@/lib/repair-notifications', () => ({
  notifyRepairBooking: mocks.notifyRepairBooking,
}));

describe('createRepair pickup payment gate', () => {
  it('rejects direct unpaid pickup creation before the booking RPC', async () => {
    const result = await createRepair(
      {
        ...validRepairInput,
        pickupAddress: '12 Station Road, Osogbo, Osun, Nigeria',
        serviceType: 'pickup',
      },
      '123e4567-e89b-12d3-a456-426614174000'
    );

    expect(result).toEqual({
      code: 'unavailable',
      success: false,
      error: 'Courier pickup must be paid before booking.',
    });
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
    expect(mocks.notifyRepairBooking).not.toHaveBeenCalled();
  });
});

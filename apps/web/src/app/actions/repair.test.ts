import { beforeEach, describe, expect, it, vi } from 'vitest';
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

const merchantId = '123e4567-e89b-12d3-a456-426614174000';

describe('createRepair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.notifyRepairBooking.mockResolvedValue(undefined);
  });

  it('delegates to the booking core and notifies the merchant/customer on success', async () => {
    mocks.createRepairBooking.mockResolvedValueOnce({
      success: true,
      id: 'repair-1',
      ticketNumber: 42,
    });

    const result = await createRepair(validRepairInput, merchantId);

    expect(result).toEqual({ success: true, id: 'repair-1', ticketNumber: 42 });
    expect(mocks.createRepairBooking).toHaveBeenCalledWith(
      validRepairInput,
      merchantId
    );
    expect(mocks.notifyRepairBooking).toHaveBeenCalledWith({
      customerEmail: validRepairInput.customerEmail,
      customerName: validRepairInput.customerName,
      deviceModel: validRepairInput.deviceModel,
      deviceType: validRepairInput.deviceType,
      merchantId,
      pickupAddress: null,
      quoteId: null,
      repairId: 'repair-1',
      serviceType: validRepairInput.serviceType,
      ticketNumber: 42,
    });
  });

  it('passes the catalogue quote id through to the notification when present', async () => {
    mocks.createRepairBooking.mockResolvedValueOnce({
      success: true,
      id: 'repair-2',
      ticketNumber: 43,
    });

    await createRepair(
      { ...validRepairInput, quoteId: '223e4567-e89b-12d3-a456-426614174999' },
      merchantId
    );

    expect(mocks.notifyRepairBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        quoteId: '223e4567-e89b-12d3-a456-426614174999',
      })
    );
  });

  it('returns the core failure without notifying', async () => {
    mocks.createRepairBooking.mockResolvedValueOnce({
      success: false,
      error: 'Store not found.',
    });

    const result = await createRepair(validRepairInput, merchantId);

    expect(result).toEqual({ success: false, error: 'Store not found.' });
    expect(mocks.notifyRepairBooking).not.toHaveBeenCalled();
  });

  it('rejects unpaid pickup bookings without throwing on a malformed payload', async () => {
    const result = await createRepair(
      { serviceType: 'pickup' } as never,
      merchantId
    );

    expect(result).toEqual({
      success: false,
      code: 'unavailable',
      error: 'Courier pickup must be paid before booking.',
    });
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
  });

  it('returns validation_failed when the payload is not an object', async () => {
    const result = await createRepair(null as never, merchantId);

    expect(result).toEqual({
      success: false,
      code: 'validation_failed',
      error: 'Enter valid repair details.',
    });
    expect(mocks.createRepairBooking).not.toHaveBeenCalled();
  });
});

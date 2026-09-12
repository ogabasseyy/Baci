import { describe, expect, it, vi } from 'vitest';
import { markRepairPickupAwaitingPayment } from './mark-repair-pickup-awaiting-payment';

const mocks = vi.hoisted(() => ({
  createRepairPickupReceiverClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/repairs/repair-pickup-receiver-client', () => ({
  createRepairPickupReceiverClient: mocks.createRepairPickupReceiverClient,
}));

const merchantId = '123e4567-e89b-12d3-a456-426614174000';
const repairId = '223e4567-e89b-12d3-a456-426614174000';

describe('markRepairPickupAwaitingPayment', () => {
  it('marks unpaid pickups through the receiver capability RPC', async () => {
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: [{ marked: true }],
      error: null,
    });

    const result = await markRepairPickupAwaitingPayment({
      merchantId,
      repairId,
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.createRepairPickupReceiverClient).toHaveBeenCalledWith(
      merchantId
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'mark_repair_pickup_awaiting_payment',
      {
        p_merchant_id: merchantId,
        p_repair_id: repairId,
      }
    );
  });

  it('fails closed when the capability RPC cannot mark the repair', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'forbidden' },
    });

    try {
      const result = await markRepairPickupAwaitingPayment({
        merchantId,
        repairId,
      });
      expect(result).toMatchObject({ ok: false });
    } finally {
      consoleSpy.mockRestore();
    }
  });

  it('fails closed when the RPC reports marked=false', async () => {
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: [{ marked: false }],
      error: null,
    });

    const result = await markRepairPickupAwaitingPayment({
      merchantId,
      repairId,
    });

    expect(result).toMatchObject({ ok: false });
  });
});

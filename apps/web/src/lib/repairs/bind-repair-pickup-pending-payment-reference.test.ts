import { describe, expect, it, vi } from 'vitest';
import { bindRepairPickupPendingPaymentReference } from './bind-repair-pickup-pending-payment-reference';

const mocks = vi.hoisted(() => ({
  createRepairPickupReceiverClient: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock('@/lib/repairs/repair-pickup-receiver-client', () => ({
  createRepairPickupReceiverClient: mocks.createRepairPickupReceiverClient,
}));

const merchantId = '123e4567-e89b-12d3-a456-426614174000';
const repairId = '223e4567-e89b-12d3-a456-426614174000';
const reference = 'RPU-ABC123DEF45678';

describe('bindRepairPickupPendingPaymentReference', () => {
  it('binds the pending RPU reference through the receiver capability RPC', async () => {
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: [{ bound: true }],
      error: null,
    });

    const result = await bindRepairPickupPendingPaymentReference({
      merchantId,
      reference,
      repairId,
    });

    expect(result).toEqual({ ok: true });
    expect(mocks.createRepairPickupReceiverClient).toHaveBeenCalledWith(
      merchantId
    );
    expect(mocks.rpc).toHaveBeenCalledWith(
      'bind_repair_pickup_pending_payment_reference',
      {
        p_merchant_id: merchantId,
        p_reference: reference,
        p_repair_id: repairId,
      }
    );
  });

  it('fails closed when the capability RPC cannot bind the reference', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createRepairPickupReceiverClient.mockReturnValue({
      rpc: mocks.rpc,
    });
    mocks.rpc.mockResolvedValueOnce({
      data: [{ bound: false }],
      error: null,
    });

    try {
      const result = await bindRepairPickupPendingPaymentReference({
        merchantId,
        reference,
        repairId,
      });
      expect(result).toMatchObject({ ok: false });
    } finally {
      consoleSpy.mockRestore();
    }
  });
});

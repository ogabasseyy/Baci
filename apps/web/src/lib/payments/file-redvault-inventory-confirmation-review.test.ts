import { describe, expect, it, vi } from 'vitest';
import { fileRedvaultInventoryConfirmationReview } from './file-redvault-inventory-confirmation-review';

const baseArgs = {
  gatewayReference: 'RV-ref',
  merchantId: '6b5cb8a4-5575-456c-b936-8cdfae30db74',
  metadata: { reason: 'evidence-rejected' },
  orderId: '11111111-1111-4111-8111-111111111111',
  reason: 'REDVAULT capture evidence requires review: evidence-rejected',
  transactionId: '22222222-2222-4222-8222-222222222222',
};

function client(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as unknown as Parameters<
    typeof fileRedvaultInventoryConfirmationReview
  >[0]['supabase'];
}

describe('fileRedvaultInventoryConfirmationReview', () => {
  it('files through the scoped review RPC instead of a direct table write', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { duplicate: false, filed: true },
      error: null,
    });
    await fileRedvaultInventoryConfirmationReview({
      ...baseArgs,
      supabase: client(rpc),
    });
    expect(rpc).toHaveBeenCalledWith(
      'file_uba_redvault_inventory_confirmation_review',
      {
        p_gateway_reference: baseArgs.gatewayReference,
        p_merchant_id: baseArgs.merchantId,
        p_metadata: baseArgs.metadata,
        p_order_id: baseArgs.orderId,
        p_reason: baseArgs.reason,
        p_transaction_id: baseArgs.transactionId,
      }
    );
  });

  it('treats a duplicate open review as a no-op without throwing', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { duplicate: true, filed: false },
      error: null,
    });
    await expect(
      fileRedvaultInventoryConfirmationReview({
        ...baseArgs,
        supabase: client(rpc),
      })
    ).resolves.toBeUndefined();
  });

  it('swallows RPC errors without throwing', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'boom' },
    });
    await expect(
      fileRedvaultInventoryConfirmationReview({
        ...baseArgs,
        supabase: client(rpc),
      })
    ).resolves.toBeUndefined();
    const throwing = vi.fn().mockRejectedValue(new Error('boom'));
    await expect(
      fileRedvaultInventoryConfirmationReview({
        ...baseArgs,
        supabase: client(throwing),
      })
    ).resolves.toBeUndefined();
  });
});

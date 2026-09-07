import { describe, expect, it, vi } from 'vitest';
import { persistMerchantWalletAssignmentEvent } from './persist-merchant-wallet-assignment-event';

function assignmentClient(rpc: ReturnType<typeof vi.fn>) {
  const requestChain: Record<string, unknown> = {};
  requestChain.select = () => requestChain;
  requestChain.eq = () => requestChain;
  requestChain.in = () => requestChain;
  // biome-ignore lint/suspicious/noThenProperty: Supabase query mocks are thenable.
  requestChain.then = (resolve: (value: unknown) => unknown) =>
    resolve({
      data: [{ id: 'r', merchant_id: 'm', status: 'pending' }],
      error: null,
    });
  return {
    from: () => requestChain,
    rpc,
  } as unknown as Parameters<typeof persistMerchantWalletAssignmentEvent>[0];
}

const payload = {
  data: {
    metadata: {
      source: 'merchant_wallet_funding',
      request_id: 'r',
      merchant_id: 'm',
    },
    account_number: '1234567890',
    currency: 'NGN',
  },
};

describe('persistMerchantWalletAssignmentEvent alias conflict', () => {
  it('ignores an explicit sibling-flow source even when customer metadata is wallet funding', async () => {
    const rpc = vi.fn();
    const result = await persistMerchantWalletAssignmentEvent(
      assignmentClient(rpc),
      {
        data: {
          metadata: {
            source: 'order_dva',
            order_id: 'o1',
          },
          customer: {
            metadata: {
              source: 'merchant_wallet_funding',
              request_id: 'r',
              merchant_id: 'm',
            },
          },
          account_number: '1234567890',
          currency: 'NGN',
        },
      }
    );
    expect(result.kind).toBe('ignored');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails the pending request when assignment hits PAYSTACK_DVA_ALIAS_CONFLICT', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'PAYSTACK_DVA_ALIAS_CONFLICT' },
      })
      .mockResolvedValueOnce({ data: null, error: null });

    expect(
      (
        await persistMerchantWalletAssignmentEvent(
          assignmentClient(rpc),
          payload
        )
      ).kind
    ).toBe('conflict');
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      'reject_merchant_wallet_funding_alias_conflict',
      {
        p_request_id: 'r',
        p_merchant_id: 'm',
        p_account_number: '1234567890',
      }
    );
  });

  it('propagates reject RPC failure so the webhook can retry', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'PAYSTACK_DVA_ALIAS_CONFLICT' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'reject failed' },
      });

    await expect(
      persistMerchantWalletAssignmentEvent(assignmentClient(rpc), payload)
    ).rejects.toMatchObject({ message: 'reject failed' });
  });
});

import { describe, expect, it, vi } from 'vitest';

const persistAssignment = vi.hoisted(() => vi.fn());
const persistReview = vi.hoisted(() => vi.fn());
vi.mock('./persist-merchant-wallet-assignment-event', () => ({
  persistMerchantWalletAssignmentEvent: persistAssignment,
}));
vi.mock('./persist-merchant-wallet-assignment-review', () => ({
  persistMerchantWalletAssignmentReview: persistReview,
}));

const { handlePaystackMerchantWalletAssignmentSuccess } = await import(
  './paystack-merchant-wallet-assignment-success-webhook'
);

describe('Paystack merchant-wallet assignment success webhook', () => {
  it.each([
    [
      { kind: 'match' },
      200,
      { success: true, handled: 'merchant_wallet_assignment' },
    ],
    [
      { kind: 'conflict' },
      200,
      { success: true, handled: 'merchant_wallet_alias_conflict' },
    ],
    [{ kind: 'ignored' }, 200, { message: 'Event ignored' }],
    [
      { kind: 'review' },
      200,
      {
        success: true,
        handled: 'merchant_wallet_assignment_review',
        code: 'MERCHANT_WALLET_ASSIGNMENT_REVIEW',
      },
    ],
  ] as const)('returns the %s outcome safely', async (outcome, status, body) => {
    persistAssignment.mockResolvedValueOnce(outcome);
    persistReview.mockResolvedValueOnce(undefined);

    const payload = { event: 'dedicatedaccount.assign.success' };
    const response = await handlePaystackMerchantWalletAssignmentSuccess(
      {} as never,
      payload
    );

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(body);
    if (outcome.kind === 'review') {
      expect(persistReview).toHaveBeenCalledWith({}, payload);
    } else {
      expect(persistReview).not.toHaveBeenCalled();
    }
  });
});

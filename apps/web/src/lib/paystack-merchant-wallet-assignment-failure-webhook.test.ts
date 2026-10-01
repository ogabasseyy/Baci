import { describe, expect, it, vi } from 'vitest';

const failAssignment = vi.hoisted(() => vi.fn());
const persistReview = vi.hoisted(() => vi.fn());
vi.mock('./merchant-wallet-assignment-events', () => ({
  failMerchantWalletAssignmentEvent: failAssignment,
}));
vi.mock('./persist-merchant-wallet-assignment-review', () => ({
  persistMerchantWalletAssignmentReview: persistReview,
}));

const { handlePaystackMerchantWalletAssignmentFailure } = await import(
  './paystack-merchant-wallet-assignment-failure-webhook'
);

describe('Paystack merchant-wallet assignment failure webhook', () => {
  it.each([
    [
      { kind: 'match' },
      200,
      { success: true, handled: 'merchant_wallet_assignment_failure' },
    ],
    [{ kind: 'ignored' }, 200, { message: 'Event ignored' }],
    [
      { kind: 'review' },
      200,
      {
        success: true,
        handled: 'merchant_wallet_assignment_failure_review',
        code: 'MERCHANT_WALLET_ASSIGNMENT_FAILURE_REVIEW',
      },
    ],
  ] as const)('returns the %s outcome safely', async (outcome, status, body) => {
    failAssignment.mockResolvedValueOnce(outcome);
    persistReview.mockResolvedValueOnce(undefined);

    const payload = { event: 'dedicatedaccount.assign.failed' };
    const response = await handlePaystackMerchantWalletAssignmentFailure(
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

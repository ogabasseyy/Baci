import { completeSubmittedOrder } from './complete-submitted-order';
import { runCheckoutFinalization } from './run-checkout-finalization';
import { runRedvaultPostOrderBranch } from './run-redvault-post-order-branch';

jest.mock('./run-checkout-finalization', () => ({
  runCheckoutFinalization: jest.fn(),
}));
jest.mock('./run-redvault-post-order-branch', () => ({
  runRedvaultPostOrderBranch: jest.fn(),
}));
const params = {
  order: { id: 'committed-order', total: 5000 },
  orderResponse: { order: { id: 'committed-order', total: 5000 } },
  checkoutGeneration: 'same-generation',
  selectedPayment: 'uba_redvault',
  completedPaymentMethod: 'bank_transfer',
  customerEmail: 'buyer@example.com',
  customerName: 'Buyer',
  customerPhone: '08012345678',
} as unknown as Parameters<typeof completeSubmittedOrder>[0];
beforeEach(() => jest.resetAllMocks());
it('does not finalize twice when REDVAULT claims completion', async () => {
  jest.mocked(runRedvaultPostOrderBranch).mockResolvedValue(true);
  expect(await completeSubmittedOrder(params)).toBe(true);
  expect(runRedvaultPostOrderBranch).toHaveBeenCalledWith(
    expect.objectContaining({
      order: params.order,
      checkoutGeneration: 'same-generation',
    })
  );
  expect(runCheckoutFinalization).not.toHaveBeenCalled();
});
it('waits for ordinary finalization before reporting completion', async () => {
  jest.mocked(runRedvaultPostOrderBranch).mockResolvedValue(false);
  let finish: () => void = () => undefined;
  jest.mocked(runCheckoutFinalization).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  let completed = false;
  const result = completeSubmittedOrder(params).then((claimed) => {
    completed = true;
    return claimed;
  });
  await Promise.resolve();
  expect(completed).toBe(false);
  expect(runCheckoutFinalization).toHaveBeenCalledWith(params);
  finish();
  expect(await result).toBe(false);
});
it('does not fall through to ordinary payment finalization after REDVAULT failure', async () => {
  const error = new Error('indeterminate provider response');
  jest.mocked(runRedvaultPostOrderBranch).mockRejectedValue(error);
  await expect(completeSubmittedOrder(params)).rejects.toBe(error);
  expect(runCheckoutFinalization).not.toHaveBeenCalled();
});
it('propagates standard finalization failure instead of claiming success', async () => {
  const error = new Error('finalization pending');
  jest.mocked(runRedvaultPostOrderBranch).mockResolvedValue(false);
  jest.mocked(runCheckoutFinalization).mockRejectedValue(error);
  await expect(completeSubmittedOrder(params)).rejects.toBe(error);
  expect(runCheckoutFinalization).toHaveBeenCalledTimes(1);
});
it('bugfix: a settled quiz prize skips the REDVAULT review and finalizes', async () => {
  const prizeParams = {
    ...params,
    itemsSnapshot: [
      {
        id: 'prize-1',
        name: 'iPhone XR',
        price: 0,
        product_id: 'product-1',
        quantity: 1,
        slug: 'iphone-xr',
        voucher_award_id: 'award-1',
        voucher_token: 'token-1',
      },
    ],
    order: { id: 'prize-order', payment_status: 'paid', total: 3500 },
    orderResponse: {
      amountDueToGateway: 0,
      order: { id: 'prize-order', payment_status: 'paid', total: 3500 },
    },
  } as unknown as Parameters<typeof completeSubmittedOrder>[0];

  expect(await completeSubmittedOrder(prizeParams)).toBe(false);
  expect(runRedvaultPostOrderBranch).not.toHaveBeenCalled();
  expect(runCheckoutFinalization).toHaveBeenCalledWith(prizeParams);
});
it('still sends an unpaid prize-cart order through REDVAULT handling', async () => {
  jest.mocked(runRedvaultPostOrderBranch).mockResolvedValue(true);
  const unpaid = {
    ...params,
    itemsSnapshot: [{ voucher_award_id: 'award-1', voucher_token: 'token-1' }],
    order: { id: 'prize-order', payment_status: 'pending', total: 3500 },
  } as unknown as Parameters<typeof completeSubmittedOrder>[0];

  expect(await completeSubmittedOrder(unpaid)).toBe(true);
  expect(runRedvaultPostOrderBranch).toHaveBeenCalledTimes(1);
});

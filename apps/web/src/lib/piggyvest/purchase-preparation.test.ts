import { expect, it, vi } from 'vitest';
import { createPurchasePreparation } from './purchase-preparation';

vi.mock('server-only', () => ({}));
const goalId = '30000000-0000-4000-8000-000000000001';
const operationId = '80000000-0000-4000-8000-000000000001';
const actorId = '90000000-0000-4000-8000-000000000001';
const configuration = {
  environment: 'staging',
  transport: 'local_test',
  integrationId: '40000000-0000-4000-8000-000000000001',
  merchantId: '10000000-0000-4000-8000-000000000001',
  customerId: '20000000-0000-4000-8000-000000000001',
  goalId,
  actorId,
  expectedBusinessId: 'synthetic-business',
};
const quote = {
  quoteId: goalId,
  revisionId: goalId,
  productId: goalId,
  variantId: null,
  condition: 'new',
  currency: 'NGN',
  quantity: 1,
  termsVersion: 'synthetic-v1',
  termsHash: 'a'.repeat(64),
  deviceKobo: 100,
  deliveryKobo: 10,
  taxKobo: 0,
  feeKobo: 0,
  totalKobo: 110,
  savingsKobo: 100,
  otherPaymentKobo: 10,
  principalKobo: 95,
  paidInterestKobo: 5,
  surplusKobo: 20,
  expiresAt: '2099-01-01T00:00:00Z',
};
const receipt = {
  status: 'purchase_pending',
  operationId,
  quoteId: goalId,
  savingsKobo: 100,
  otherPaymentKobo: 10,
  principalKobo: 95,
  paidInterestKobo: 5,
  surplusKobo: 20,
  collectionPaused: true,
  dispatch: 'contract_gap',
  fulfilment: 'disabled',
};
it('passes only exact confirmed quote and server actor, without a fresh quote on replay', async () => {
  const execute = vi.fn().mockResolvedValue({ rows: [{ result: receipt }] });
  const plan = createPurchasePreparation({ configuration, execute });
  expect(await plan.prepare({ operationId, accepted: true, quote })).toEqual(
    receipt
  );
  expect(await plan.prepare({ operationId, accepted: true, quote })).toEqual(
    receipt
  );
  expect(execute.mock.calls[0]).toEqual(execute.mock.calls[1]);
  expect(JSON.parse(execute.mock.calls[0][1][5])).toEqual({
    operationId,
    actorId,
    accepted: true,
    quote,
  });
});
it('retains uncertainty without retry and never enables dispatch', async () => {
  const execute = vi.fn().mockRejectedValue(new Error('private detail'));
  const plan = createPurchasePreparation({ configuration, execute });
  expect(await plan.prepare({ operationId, accepted: true, quote })).toEqual({
    status: 'unavailable',
    reservation: 'may_be_retained',
    dispatch: 'contract_gap',
  });
  expect(execute).toHaveBeenCalledOnce();
});
it('rejects actor spoof, non-local config and contradictory payment totals', async () => {
  const execute = vi.fn();
  expect(() =>
    createPurchasePreparation({
      configuration: { ...configuration, transport: 'tls' },
      execute,
    })
  ).toThrow();
  const plan = createPurchasePreparation({ configuration, execute });
  await plan.prepare({ operationId, actorId, accepted: true, quote });
  await plan.prepare({
    operationId,
    accepted: true,
    quote: { ...quote, totalKobo: 99 },
  });
  expect(execute).not.toHaveBeenCalled();
});
it('rejects mismatched operation receipts', async () => {
  const execute = vi.fn().mockResolvedValue({
    rows: [{ result: { ...receipt, operationId: goalId } }],
  });
  expect(
    await createPurchasePreparation({ configuration, execute }).prepare({
      operationId,
      accepted: true,
      quote,
    })
  ).toMatchObject({ reservation: 'may_be_retained' });
});
it('reads exact quote and durable status without financial writes', async () => {
  const execute = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ result: quote }] })
    .mockResolvedValueOnce({ rows: [{ result: receipt }] });
  const plan = createPurchasePreparation({ configuration, execute });
  expect(await plan.quote({ quoteId: goalId })).toEqual(quote);
  expect(await plan.status({ operationId })).toEqual(receipt);
  expect(execute.mock.calls[0][0]).toContain('.quote(');
  expect(execute.mock.calls[1][0]).toContain('.status(');
});

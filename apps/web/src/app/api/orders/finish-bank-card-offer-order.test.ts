import { expect, it, vi } from 'vitest';
import { offerFixture } from './bank-card-offer.test-support';
import { finishBankCardOfferOrder } from './finish-bank-card-offer-order';

vi.mock('@/lib/quiz-proof', () => ({
  createQuizRpcServerProof: () => 'test-proof',
}));

function setup() {
  const rpc = vi.fn();
  const repairEffects = vi.fn();
  const options = {
    offer: offerFixture,
    userId: 'session-user',
    requestHash: 'fixture',
    client: { rpc },
    orderArgs: {},
    items: [
      {
        __baci_line_ordinal: 1,
        assurance_fee: 0,
        product_id: offerFixture.eligibleProductIds[0],
        price: 100,
        quantity: 1,
      },
    ],
    fees: [0, 0, 0] as const,
    currency: 'NGN',
    expectedTotal: 95,
    hasIncompatibleDiscount: false,
    merchantId: offerFixture.merchantId,
    merchantSlug: 'ogabassey',
    repairEffects,
  };
  return { rpc, repairEffects, options };
}

it.each([
  {
    change: { fees: [0.005, 0, 0] as const },
    code: 'BANK_CARD_OFFER_AMOUNT_INVALID',
  },
  {
    change: { hasIncompatibleDiscount: true },
    code: 'BANK_CARD_OFFER_UNAVAILABLE',
  },
  { change: { currency: 'USD' }, code: 'BANK_CARD_OFFER_UNAVAILABLE' },
  { change: { items: [] }, code: 'BANK_CARD_OFFER_UNAVAILABLE' },
  { change: { expectedTotal: 100 }, code: 'BANK_CARD_OFFER_TOTAL_MISMATCH' },
])('returns $code without creating an order or running effects', async ({
  code,
  change,
}) => {
  const { options, rpc, repairEffects } = setup();

  const response = await finishBankCardOfferOrder({ ...options, ...change });

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({ code });
  expect(rpc).not.toHaveBeenCalled();
  expect(repairEffects).not.toHaveBeenCalled();
});

it('returns the cart validation error when quantity exceeds the quote limit', async () => {
  const { options, rpc, repairEffects } = setup();
  options.items[0].quantity = 10_001;

  const response = await finishBankCardOfferOrder(options);

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    code: 'BANK_CARD_OFFER_CART_INVALID',
  });
  expect(rpc).not.toHaveBeenCalled();
  expect(repairEffects).not.toHaveBeenCalled();
});

it.each([
  { error: { code: 'P0001' }, data: null },
  { error: null, data: null },
])('withholds the order and effects when persistence returns %j', async (result) => {
  const { options, rpc, repairEffects } = setup();
  rpc.mockResolvedValue(result);

  const response = await finishBankCardOfferOrder(options);

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    code: 'BANK_CARD_OFFER_ORDER_REJECTED',
  });
  expect(repairEffects).not.toHaveBeenCalled();
});

it('returns the standard conflict when the key belongs to another checkout', async () => {
  const { options, rpc, repairEffects } = setup();
  rpc.mockResolvedValue({
    error: { message: 'checkout_idempotency_conflict' },
    data: null,
  });

  const response = await finishBankCardOfferOrder(options);

  expect(response.status).toBe(409);
  await expect(response.json()).resolves.toMatchObject({
    code: 'CHECKOUT_IDEMPOTENCY_CONFLICT',
  });
  expect(repairEffects).not.toHaveBeenCalled();
});

it.each([
  { replayed: false, status: 201 },
  { replayed: true, status: 200 },
])('runs post-commit effects before returning a $status response', async ({
  replayed,
  status,
}) => {
  const { options, rpc, repairEffects } = setup();
  const order = { id: 'order-1', total: 95, idempotency_replayed: replayed };
  rpc.mockResolvedValue({ data: order, error: null });

  const response = await finishBankCardOfferOrder(options);

  expect(response.status).toBe(status);
  expect(response.headers.get('x-idempotency-replayed')).toBe(
    replayed ? 'true' : null
  );
  await expect(response.json()).resolves.toEqual({
    order,
    ...(replayed ? { idempotency: { replayed: true } } : {}),
  });
  expect(repairEffects).toHaveBeenCalledExactlyOnceWith(
    order,
    options.merchantSlug
  );
});

it('returns the committed order even if a post-checkout effect fails', async () => {
  const { options, rpc, repairEffects } = setup();
  const order = { id: 'order-1', total: 95 };
  rpc.mockResolvedValue({ data: order, error: null });
  repairEffects.mockRejectedValue(
    new Error('Post-checkout effect unavailable')
  );

  const response = await finishBankCardOfferOrder(options);

  expect(response.status).toBe(201);
  await expect(response.json()).resolves.toEqual({ order });
});

it('includes server-computed exclusive tax in the exact amount before order creation', async () => {
  const { options, rpc } = setup();
  const taxAmount = 2.5;
  rpc.mockResolvedValue({
    data: { id: 'taxed-order', total: 97.5 },
    error: null,
  });
  const taxed = {
    ...options,
    fees: [0, taxAmount, 0] as const,
    orderArgs: { p_tax_amount: taxAmount },
  };

  expect((await finishBankCardOfferOrder(taxed)).status).toBe(409);
  expect(rpc).not.toHaveBeenCalled();
  expect(
    (await finishBankCardOfferOrder({ ...taxed, expectedTotal: 97.5 })).status
  ).toBe(201);
  expect(rpc).toHaveBeenCalledWith(
    'create_storefront_bank_card_offer_order',
    expect.objectContaining({
      p_order: expect.objectContaining({ tax_amount: taxAmount }),
    })
  );
});

import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, expect, it, vi } from 'vitest';
import type { OrderCreateInput } from '@/schemas/orders';
import { offerFixture } from './bank-card-offer.test-support';
import { prepareBankCardOfferOrder } from './prepare-bank-card-offer-order';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  purge: vi.fn(),
  record: vi.fn(),
  configuredOffers: [] as unknown[],
}));
const { rpc } = mocks;

vi.mock('@/config/bank-card-offers', () => ({
  BANK_CARD_OFFERS: mocks.configuredOffers,
}));
vi.mock('@/lib/checkout/schedule-checkout-product-blog-purge', () => ({
  scheduleCheckoutProductBlogPurge: mocks.purge,
}));

const maybeSingle = vi.fn();
const from = vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.configuredOffers.splice(0, Number.POSITIVE_INFINITY, offerFixture);
  rpc.mockResolvedValue({ data: null, error: null });
  from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
  maybeSingle.mockResolvedValue({ data: { slug: 'ogabassey' }, error: null });
});
const options = {
  merchantId: '123e4567-e89b-12d3-a456-426614174000',
  customerEmail: 'buyer@example.test',
  requestIdempotencyKey: 'checkout',
  hasVoucherItem: false,
  clientIp: '127.0.0.1',
  supabase: { rpc, from } as unknown as SupabaseClient,
  createScopedClient: () => ({ rpc }) as unknown as SupabaseClient,
  recordOrderCreated: mocks.record,
};

it('leaves standard checkout to the existing route without reading any offer', async () => {
  await expect(
    prepareBankCardOfferOrder({
      ...options,
      body: { payment_method: 'card' } as OrderCreateInput,
    })
  ).resolves.toEqual({ kind: 'standard' });
  expect(rpc).not.toHaveBeenCalled();
});

it.each([
  { userId: undefined, userEmail: undefined, status: 401 },
  { userId: 'session-user', userEmail: 'other@example.test', status: 403 },
])('rejects bank-offer buyer authorization before replay with $status', async ({
  userId,
  userEmail,
  status,
}) => {
  const result = await prepareBankCardOfferOrder({
    ...options,
    userId,
    userEmail,
    body: {
      payment_method: 'bank_card_offer',
      bank_card_offer_id: 'black-friday',
    } as OrderCreateInput,
  });
  expect(result.kind).toBe('response');
  if (result.kind === 'response') {
    expect(result.response.status).toBe(status);
    await expect(result.response.json()).resolves.toMatchObject({
      code: 'BANK_CARD_OFFER_BUYER_REQUIRED',
    });
  }
  expect(rpc).not.toHaveBeenCalled();
});

const bankRequest = {
  ...options,
  userId: 'session-user',
  userEmail: options.customerEmail,
  body: {
    payment_method: 'bank_card_offer',
    bank_card_offer_id: 'black-friday',
    items: [],
  } as unknown as OrderCreateInput,
};

it('requires a checkout key before reading an order', async () => {
  const result = await prepareBankCardOfferOrder({
    ...bankRequest,
    requestIdempotencyKey: null,
  });

  if (result.kind !== 'response') throw new Error('Expected a request error');
  expect(result.response.status).toBe(400);
  await expect(result.response.json()).resolves.toMatchObject({
    code: 'BANK_CARD_OFFER_CHECKOUT_KEY_REQUIRED',
  });
  expect(rpc).not.toHaveBeenCalled();
});

it('reports voucher incompatibility when the route omits the checkout key', async () => {
  const result = await prepareBankCardOfferOrder({
    ...bankRequest,
    hasVoucherItem: true,
    requestIdempotencyKey: null,
  });

  if (result.kind !== 'response') throw new Error('Expected a request error');
  expect(result.response.status).toBe(409);
  await expect(result.response.json()).resolves.toMatchObject({
    code: 'BANK_CARD_OFFER_UNAVAILABLE',
  });
  expect(rpc).not.toHaveBeenCalled();
});

it('selects the enabled offer for a fresh checkout owned by the buyer', async () => {
  const result = await prepareBankCardOfferOrder({
    ...bankRequest,
    userEmail: ' BUYER@Example.Test ',
  });

  expect(result).toMatchObject({
    kind: 'checkout',
    offer: offerFixture,
    userId: 'session-user',
    requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(rpc).toHaveBeenCalledExactlyOnceWith(
    'get_bank_card_offer_checkout_replay',
    {
      p_merchant_id: options.merchantId,
      p_key: options.requestIdempotencyKey,
      p_hash: expect.any(String),
    }
  );
  expect(mocks.record).not.toHaveBeenCalled();
});

it.each([
  {
    message: 'checkout_idempotency_conflict',
    code: 'CHECKOUT_IDEMPOTENCY_CONFLICT',
    status: 409,
  },
  {
    message: 'order_not_reusable',
    code: 'CHECKOUT_ORDER_NOT_REUSABLE',
    status: 409,
  },
  {
    message: 'database unavailable',
    code: 'BANK_CARD_OFFER_REPLAY_UNAVAILABLE',
    status: 503,
  },
])('fails closed on a replay lookup error with $code', async ({
  message,
  code,
  status,
}) => {
  rpc.mockResolvedValue({ error: { message }, data: null });

  const result = await prepareBankCardOfferOrder(bankRequest);

  if (result.kind !== 'response') throw new Error('Expected rejected checkout');
  expect(result.response.status).toBe(status);
  await expect(result.response.json()).resolves.toMatchObject({ code });
  expect(mocks.record).not.toHaveBeenCalled();
});

it.each([
  { ...offerFixture, id: 'other-offer' },
  { ...offerFixture, enabled: false },
])('rejects a fresh checkout without an enabled matching offer (%j)', async (offer) => {
  mocks.configuredOffers.splice(0, Number.POSITIVE_INFINITY, offer);

  const result = await prepareBankCardOfferOrder(bankRequest);

  if (result.kind !== 'response')
    throw new Error('Expected unavailable checkout');
  expect(result.response.status).toBe(409);
  await expect(result.response.json()).resolves.toMatchObject({
    code: 'BANK_CARD_OFFER_UNAVAILABLE',
  });
});

it('restores an existing order after disabling the offer and repairs its effects', async () => {
  mocks.configuredOffers.splice(0, Number.POSITIVE_INFINITY, {
    ...offerFixture,
    enabled: false,
  });
  const savedOrder = {
    id: 'order-1',
    created_at: '2026-11-27T12:00:00Z',
    total: 95,
  };
  rpc.mockResolvedValue({ data: savedOrder, error: null });

  const result = await prepareBankCardOfferOrder(bankRequest);

  if (result.kind !== 'response') throw new Error('Expected replay response');
  expect(result.response.status).toBe(200);
  expect(result.response.headers.get('x-idempotency-replayed')).toBe('true');
  await expect(result.response.json()).resolves.toEqual({
    order: savedOrder,
    idempotency: { replayed: true },
  });
  expect(mocks.purge).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      orderId: savedOrder.id,
      merchantSlug: 'ogabassey',
    })
  );
  expect(mocks.record).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      orderId: savedOrder.id,
      eventTimestamp: savedOrder.created_at,
      value: 95,
    })
  );
});

it('withholds a replay when its merchant context is unavailable', async () => {
  rpc.mockResolvedValue({ data: { id: 'order-1' }, error: null });
  maybeSingle.mockResolvedValue({ data: null, error: null });

  const result = await prepareBankCardOfferOrder(bankRequest);

  if (result.kind !== 'response')
    throw new Error('Expected unavailable replay');
  expect(result.response.status).toBe(503);
  expect(mocks.purge).not.toHaveBeenCalled();
  expect(mocks.record).not.toHaveBeenCalled();
});

it('returns a saved order even if its event repair fails', async () => {
  const order = {
    id: 'order-1',
    created_at: '2026-11-27T12:00:00Z',
    total: 95,
  };
  rpc.mockResolvedValue({ data: order, error: null });
  mocks.record.mockRejectedValueOnce(new Error('Event enqueue unavailable'));

  const result = await prepareBankCardOfferOrder(bankRequest);

  if (result.kind !== 'response') throw new Error('Expected replay response');
  await expect(result.response.json()).resolves.toEqual({
    order,
    idempotency: { replayed: true },
  });
  expect(result.response.status).toBe(200);
});

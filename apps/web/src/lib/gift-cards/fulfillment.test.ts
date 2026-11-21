import { expect, it, vi } from 'vitest';
import { createPetrockClient } from '../imei-providers/petrock/petrock-client';
import { confirmGiftCardPurchase } from './checkout';
import { resolveGiftCardFulfillment } from './fulfillment';
import { createMockGiftCardWallet } from './mock-wallet';
import { getGiftCardQuote } from './quote';

const identity = { orderId: 'mock-order', reference: 'mock-quote' };
const final = {
  orderUuid: identity.orderId,
  referenceId: identity.reference,
  replay: 'SYNTHETIC-REPLAY',
  status: 'success' as const,
};

const decode = (replay: string) =>
  replay === 'SYNTHETIC-REPLAY' ? 'DEMO-GIFT-CARD' : null;

it('shows the mocked price, debits once on confirmation, and delivers only after a matching authenticated order read', async () => {
  const wallet = createMockGiftCardWallet(2_000_000);
  const rateFetch = vi.fn().mockResolvedValue(
    Response.json({
      data: { rate: 147999, symbol: 'USD-NGN', type: 'sell', locked: false },
    })
  );
  const petrockFetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        data: [
          [{ order_uuid: identity.orderId, reference_id: identity.reference }],
        ],
      })
    )
    .mockResolvedValueOnce(
      Response.json({
        data: {
          order_uuid: identity.orderId,
          reference_id: identity.reference,
          replay: null,
          status: 'pending',
        },
      })
    )
    .mockResolvedValueOnce(
      Response.json({
        data: {
          order_uuid: identity.orderId,
          reference_id: identity.reference,
          replay: final.replay,
          status: 'success',
        },
      })
    );
  const provider = createPetrockClient({
    baseUrl: 'https://petrock.example.test',
    token: 'fixture',
    fetchImpl: petrockFetch,
  });

  const totalKobo = await getGiftCardQuote(500, 1000, 'fixture', rateFetch);
  expect(totalKobo).toBe(813995);
  expect(wallet.balance()).toBe(2_000_000);
  expect(petrockFetch).not.toHaveBeenCalled();
  const result = await confirmGiftCardPurchase(
    {
      id: identity.reference,
      cardId: '3007',
      totalKobo,
      expiresAt: 60_000,
    },
    wallet,
    async ({ cardId, reference }) => {
      const submitted = await provider.submitGiftCardOrder({
        productId: cardId,
        referenceId: reference,
        feedbackUrl: 'https://example.test/feedback/mock',
      });
      if (!submitted.ok) throw new Error('Mock submission failed');
      return { orderId: submitted.data.orderUuid };
    },
    () => 1000
  );
  expect(result).toEqual({ status: 'submitted', orderId: identity.orderId });
  expect(wallet.balance()).toBe(1_186_005);

  const pending = await provider.getOrder(identity.orderId);
  const completed = await provider.getOrder(identity.orderId);
  expect(
    pending.ok && resolveGiftCardFulfillment(identity, pending.data, decode)
  ).toEqual({ status: 'pending' });
  expect(
    completed.ok && resolveGiftCardFulfillment(identity, completed.data, decode)
  ).toEqual({ status: 'fulfilled', voucher: 'DEMO-GIFT-CARD' });
  expect(
    petrockFetch.mock.calls.map((call) => call[1]?.method ?? 'GET')
  ).toEqual(['POST', 'GET', 'GET']);
});

it('withholds the voucher when completion data is missing or for another order', () => {
  expect(
    resolveGiftCardFulfillment(
      identity,
      { ...final, referenceId: 'other' },
      decode
    )
  ).toEqual({ status: 'review' });
  expect(
    resolveGiftCardFulfillment(
      identity,
      { ...final, orderUuid: 'other' },
      decode
    )
  ).toEqual({ status: 'review' });
  expect(
    resolveGiftCardFulfillment(
      identity,
      { ...final, replay: 'unknown format' },
      decode
    )
  ).toEqual({ status: 'review' });
  expect(resolveGiftCardFulfillment(identity, final)).toEqual({
    status: 'review',
  });
});

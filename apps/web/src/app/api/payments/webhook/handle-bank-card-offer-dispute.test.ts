import { describe, expect, it, vi } from 'vitest';
import { handleBankCardOfferDispute } from './handle-bank-card-offer-dispute';

const reference = `BCO-${'a'.repeat(32)}`;

it('uses the nested transaction reference when Paystack leaves the direct reference null', async () => {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const result = await handleBankCardOfferDispute(
    'charge.dispute.resolve',
    {
      id: 91,
      transaction_reference: null,
      merchant_transaction_reference: 'merchant-order-1',
      status: 'resolved',
      resolution: 'merchant-accepted',
      transaction: { id: 719, reference, status: 'success', amount: 9500 },
    },
    () => ({ rpc }) as never
  );
  expect(result?.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('record_bank_card_offer_dispute', {
    p_dispute_id: '91',
    p_event: 'charge.dispute.resolve',
    p_outcome: 'lost',
    p_reference: reference,
  });
});

it('does not apply a dispute outcome when its Paystack payment references conflict', async () => {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const rpc = vi.fn();
  const from = vi.fn().mockReturnValue({ insert });
  const otherReference = `BCO-${'b'.repeat(32)}`;
  const result = await handleBankCardOfferDispute(
    'charge.dispute.resolve',
    {
      id: 91,
      transaction_reference: otherReference,
      transaction: { reference },
      status: 'resolved',
      resolution: 'declined',
    },
    () => ({ rpc, from }) as never
  );
  expect(result?.status).toBe(200);
  expect(from).toHaveBeenCalledWith('reconciliation_review');
  expect(insert).toHaveBeenCalledTimes(2);
  expect(insert).toHaveBeenCalledWith(
    expect.objectContaining({ paystack_ref: reference })
  );
  expect(insert).toHaveBeenCalledWith(
    expect.objectContaining({ paystack_ref: otherReference })
  );
  expect(rpc).not.toHaveBeenCalled();
});

it.each([
  [null, 200],
  [{ code: '23505' }, 200],
  [{ code: '57014' }, 503],
] as const)('acknowledges a malformed dispute ID only after review is durable (%j)', async (error, status) => {
  const insert = vi.fn().mockResolvedValue({ error });
  const rpc = vi.fn();
  const result = await handleBankCardOfferDispute(
    'charge.dispute.create',
    { id: 'unusable', transaction_reference: reference },
    () => ({ rpc, from: () => ({ insert }) }) as never
  );
  expect(result?.status).toBe(status);
  expect(insert).toHaveBeenCalledExactlyOnceWith({
    issue_type: 'payment_match_ambiguous',
    paystack_ref: reference,
    reason: 'Bank offer dispute ID unavailable',
    metadata: {
      source: 'bank_card_offer_dispute_payload',
      event: 'charge.dispute.create',
    },
  });
  expect(rpc).not.toHaveBeenCalled();
});

describe('handleBankCardOfferDispute', () => {
  it.each([
    'charge.dispute.create',
    'charge.dispute.resolve',
  ])('holds the saved attempt for %s', async (event) => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const result = await handleBankCardOfferDispute(
      event,
      {
        id: 42,
        transaction: { reference },
        metadata: { merchant_id: 'ignored' },
      },
      () => ({ rpc }) as never
    );
    expect(result?.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('record_bank_card_offer_dispute', {
      p_dispute_id: '42',
      p_event: event,
      p_outcome: 'open',
      p_reference: reference,
    });
  });

  it.each([
    false,
    null,
  ])('asks Paystack to retry when the write returns %s', async (data) => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    const result = await handleBankCardOfferDispute(
      'charge.dispute.create',
      { id: 42, transaction_ref: reference },
      () => ({ rpc }) as never
    );
    expect(result?.status).toBe(503);
  });

  it('leaves ordinary disputes and successful charges with their existing handlers', async () => {
    const getClient = vi.fn();
    await expect(
      handleBankCardOfferDispute(
        'charge.dispute.create',
        {
          transaction: { reference: 'ordinary-123' },
        },
        getClient
      )
    ).resolves.toBeNull();
    await expect(
      handleBankCardOfferDispute(
        'charge.success',
        {
          transaction: { reference },
        },
        getClient
      )
    ).resolves.toBeNull();
    expect(getClient).not.toHaveBeenCalled();
  });
});

it.each([
  ['resolved', 'declined', 'won'],
  ['resolved', 'merchant-accepted', 'lost'],
  ['resolved', 'unknown', 'open'],
  ['pending', 'merchant-accepted', 'open'],
])('records a %s dispute with resolution %s as %s', async (status, resolution, outcome) => {
  const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
  const result = await handleBankCardOfferDispute(
    'charge.dispute.resolve',
    {
      id: '9007199254740992',
      status,
      resolution,
      transaction: { reference },
    },
    () => ({ rpc }) as never
  );
  expect(result?.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith('record_bank_card_offer_dispute', {
    p_dispute_id: '9007199254740992',
    p_event: 'charge.dispute.resolve',
    p_outcome: outcome,
    p_reference: reference,
  });
});

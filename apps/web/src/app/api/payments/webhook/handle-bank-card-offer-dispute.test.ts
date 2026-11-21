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
  const getClient = vi.fn();
  const result = await handleBankCardOfferDispute(
    'charge.dispute.resolve',
    {
      id: 91,
      transaction_reference: `BCO-${'b'.repeat(32)}`,
      transaction: { reference },
      status: 'resolved',
      resolution: 'declined',
    },
    getClient
  );
  expect(result?.status).toBe(503);
  expect(getClient).not.toHaveBeenCalled();
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

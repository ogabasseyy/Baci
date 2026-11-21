import { describe, expect, it, vi } from 'vitest';
import { handleBankCardOfferDispute } from './handle-bank-card-offer-dispute';

const reference = `BCO-${'a'.repeat(32)}`;

describe('handleBankCardOfferDispute', () => {
  it.each([
    'charge.dispute.create',
    'charge.dispute.resolve',
  ])('holds the saved attempt for %s', async (event) => {
    const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
    const result = await handleBankCardOfferDispute(
      event,
      { transaction: { reference }, metadata: { merchant_id: 'ignored' } },
      () => ({ rpc }) as never
    );
    expect(result?.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('record_bank_card_offer_dispute', {
      p_event: event,
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
      { transaction_ref: reference },
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

import { describe, expect, it, vi } from 'vitest';
import observedInterestPayout from '../../src/schemas/piggyvest/interest-payout-success.fixture.json';
import { createInterestReplay } from './replay-interest-runtime';

const config = {
  integrationId: '40000000-0000-4000-8000-000000000001',
  businessId: 'business',
  expectedSystemId: '123',
};
const event = {
  eventId: 'event-1',
  eventType: 'interest-payout.success',
  eventCategory: 'interest-payout',
  customer_id: 'customer',
  pvb_wallet: 'irrelevant',
  pvb_accrued_interest_wallet: 'source',
  pvb_reference: 'pvb-reference',
  pvb_destination_wallet: null,
  pvb_third_party_reference: null,
  eventData: {
    id: 'payout',
    amount: 1000,
    destination_wallet: 'destination',
    destination_wallet_balance: 1000,
    destination_wallet_ledger_balance: 1000,
    reference: 'reference',
    timestamp: '2026-09-26T12:00:00Z',
    batch_id: 'batch',
    break_down: {
      gross_interest_payout: 1100,
      withholding_tax: 100,
      net_interest_payout: 1000,
    },
  },
};
describe('durable interest replay adapter', () => {
  it('processes the technical-team payout category without rescaling net kobo', async () => {
    const execute = vi.fn(async () => ({ rows: [{ result: 'applied' }] }));

    await expect(
      createInterestReplay(config, execute)(observedInterestPayout)
    ).resolves.toBe('applied');

    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('apply_interest_receipt'),
      [
        config.integrationId,
        config.businessId,
        config.expectedSystemId,
        JSON.stringify({
          payoutId: observedInterestPayout.eventData.id,
          providerCustomerId: observedInterestPayout.customer_id,
          sourceWalletId: observedInterestPayout.pvb_accrued_interest_wallet,
          destinationWalletId:
            observedInterestPayout.eventData.destination_wallet,
          reference: observedInterestPayout.eventData.reference,
          amountKobo: 733,
          grossKobo: 814,
          taxKobo: 81,
          netKobo: 733,
          currency: 'NGN',
        }),
        observedInterestPayout.eventId,
      ]
    );
  });

  it('rejects inconsistent payout arithmetic before any database call', async () => {
    const execute = vi.fn();
    const conflictingPayout = {
      ...observedInterestPayout,
      eventData: {
        ...observedInterestPayout.eventData,
        break_down: {
          ...observedInterestPayout.eventData.break_down,
          withholding_tax: 82,
        },
      },
    };

    await expect(
      createInterestReplay(config, execute)(conflictingPayout)
    ).rejects.toMatchObject({ reason: 'conflict' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('credits only after the canonical bridge acknowledgement with source and destination identity', async () => {
    const execute = vi.fn(async () => ({ rows: [{ result: 'applied' }] }));
    await expect(createInterestReplay(config, execute)(event)).resolves.toBe(
      'applied'
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('apply_interest_receipt'),
      [
        config.integrationId,
        'business',
        '123',
        JSON.stringify({
          payoutId: 'payout',
          providerCustomerId: 'customer',
          sourceWalletId: 'source',
          destinationWalletId: 'destination',
          reference: 'reference',
          amountKobo: 1000,
          grossKobo: 1100,
          taxKobo: 100,
          netKobo: 1000,
          currency: 'NGN',
        }),
        'event-1',
      ]
    );
  });
  it.each([
    'deferred',
    'unknown',
  ])('does not acknowledge %s as successful processing', async (result) => {
    await expect(
      createInterestReplay(config, async () => ({ rows: [{ result }] }))(event)
    ).rejects.toThrow();
  });
  it('preserves economic conflicts as quarantine', async () => {
    await expect(
      createInterestReplay(config, async () => ({
        rows: [{ result: 'conflict' }],
      }))(event)
    ).rejects.toMatchObject({ reason: 'conflict' });
  });
  it('rejects a conflicting corroborating wallet before any database call', async () => {
    const execute = vi.fn();
    await expect(
      createInterestReplay(
        config,
        execute
      )({ ...event, pvb_destination_wallet: 'wrong' })
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it('does not acknowledge a database timeout or expose its connection details', async () => {
    await expect(
      createInterestReplay(config, async () => {
        throw new Error('password=secret');
      })(event)
    ).rejects.toThrow('Interest replay deferred');
  });
});

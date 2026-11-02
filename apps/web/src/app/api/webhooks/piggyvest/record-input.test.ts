import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/plan-wallet-restrictions', () => ({
  attributedWalletId: (event: { pvb_wallet?: string }) =>
    event.pvb_wallet ?? null,
}));
vi.mock('@/lib/piggyvest/transfer-outbox', () => ({
  outflowReferenceCandidates: (data: Record<string, unknown>) =>
    ['reference', 'third_party_reference'].flatMap((key) =>
      typeof data[key] === 'string' && data[key] ? [data[key] as string] : []
    ),
}));

import type { PiggyvestWebhookEvent } from '@/schemas/piggyvest/events';
import { toRecordInput } from './record-input';

const base = {
  eventId: 'evt-1',
  customer_id: 'customer-1',
};

const asEvent = (event: object) => event as PiggyvestWebhookEvent;

describe('toRecordInput', () => {
  it('keys an inflow by its wallet, reference and amount', () => {
    const input = toRecordInput(
      asEvent({
        ...base,
        eventType: 'bank-transfer.inflow.success',
        eventCategory: 'bank-transfer',
        pvb_wallet: 'wallet-1',
        pvb_reference: 'ref-1',
        eventData: {
          id: 'd',
          transaction_id: 'txn-1',
          amount: 1750000,
          destination_wallet_id: 'w',
          reference: 'r',
        },
      })
    );
    expect(input).toMatchObject({
      eventId: 'evt-1',
      eventType: 'bank-transfer.inflow.success',
      customerId: 'customer-1',
      walletId: 'wallet-1',
      reference: 'ref-1',
      amountKobo: 1750000,
    });
    expect(input.details).toMatchObject({ transaction_id: 'txn-1' });
  });

  it('attributes a payout to the nested destination wallet, not the source', () => {
    const input = toRecordInput(
      asEvent({
        ...base,
        eventType: 'interest-payout.success',
        eventCategory: 'interest-payout',
        pvb_wallet: 'source-wallet',
        pvb_reference: 'ref-2',
        pvb_accrued_interest_wallet: 'source-wallet',
        eventData: {
          id: 'payout-1',
          amount: 95000,
          destination_wallet: 'destination-wallet',
          reference: 'r',
          batch_id: 'b',
          timestamp: '2026-09-01T00:05:00.000Z',
          break_down: {
            gross_interest_payout: 100000,
            withholding_tax: 5000,
            net_interest_payout: 95000,
          },
        },
      })
    );
    expect(input).toMatchObject({
      walletId: 'destination-wallet',
      reference: 'ref-2',
      amountKobo: 95000,
    });
  });

  it('records the wallet a restriction flip acts on, or none when unattributed', () => {
    const restriction = (extra: object) =>
      toRecordInput(
        asEvent({
          ...base,
          eventType: 'restriction-created.success',
          eventCategory: 'restriction',
          eventData: {},
          ...extra,
        })
      );
    expect(restriction({ pvb_wallet: 'wallet-9' })).toMatchObject({
      walletId: 'wallet-9',
    });
    expect(restriction({}).walletId).toBeNull();
  });

  it('serialises ordered outflow reference candidates, or null when there are none', () => {
    const outflow = (eventData: object) =>
      toRecordInput(
        asEvent({
          ...base,
          eventType: 'bank-transfer.outflow.failed',
          eventCategory: 'bank-transfer',
          eventData,
        })
      );
    expect(
      outflow({ reference: 'a', third_party_reference: 'b' }).reference
    ).toBe(JSON.stringify(['a', 'b']));
    expect(
      outflow({ third_party_reference: 'b', reference: 'a' }).reference
    ).toBe(JSON.stringify(['a', 'b']));
    expect(outflow({}).reference).toBeNull();
  });

  it('records only the envelope for create-wallet and for record-only events', () => {
    const wallet = toRecordInput(
      asEvent({
        ...base,
        eventType: 'create-wallet.success',
        eventCategory: 'create_wallet',
        pvb_wallet: 'wallet-3',
        eventData: {},
      })
    );
    expect(wallet).toMatchObject({ walletId: 'wallet-3' });

    const accrued = toRecordInput(
      asEvent({
        ...base,
        eventType: 'interest-accrued.success',
        eventCategory: 'interest_accrued',
        eventData: { id: 'accrual-1', amount: 12.5, balance: 99 },
      })
    );
    expect(accrued).toEqual({
      eventId: 'evt-1',
      eventType: 'interest-accrued.success',
      eventCategory: 'interest_accrued',
      customerId: 'customer-1',
      details: expect.not.objectContaining({ amount: expect.anything() }),
    });
  });
});

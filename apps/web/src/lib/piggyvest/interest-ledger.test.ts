import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { InterestPayoutSuccessEvent } from '@/schemas/piggyvest/events';
import {
  InterestLedgerError,
  recordInterestPayout,
  sumPaidInterestKobo,
} from './interest-ledger';

const interestEvent: InterestPayoutSuccessEvent = {
  eventId: '01K8TESTINTEREST001',
  eventType: 'interest-payout.success',
  eventCategory: 'interest-payout',
  customer_id: 'faas-customer-synthetic-001',
  eventData: {
    id: 'faas-interest-synthetic-001',
    amount: 95000,
    destination_wallet: 'faas-wallet-synthetic-001',
    destination_wallet_balance: 1095000,
    destination_wallet_ledger_balance: 1095000,
    reference: 'faas-ref-synthetic-002',
    timestamp: '2026-09-01T00:05:00.000Z',
    batch_id: 'batch-synthetic-001',
    break_down: {
      gross_interest_payout: 100000,
      withholding_tax: 5000,
      net_interest_payout: 95000,
    },
  },
  pvb_reference: 'pvb-txn-synthetic-002',
  pvb_wallet: 'pvb-wallet-synthetic-002',
  pvb_accrued_interest_wallet: 'pvb-wallet-synthetic-001',
  pvb_destination_wallet: null,
  pvb_third_party_reference: null,
};

function thenable(result: unknown) {
  const then = (resolve: (value: unknown) => void) =>
    Promise.resolve(result).then(resolve);
  return { then };
}

const MAPPING_ROW = {
  customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  merchant_id: '43e157b6-179c-432a-9392-e0827da96d82',
  piggyvest_customer_id: 'faas-customer-synthetic-001',
  wallet_id: 'pvb-wallet-synthetic-002',
  status: 'ready',
};

function mockSupabase(options: {
  upsertResult?: { data: unknown; error: unknown };
  listResult?: { data: unknown; error: unknown };
  mappingResult?: { data: unknown; error: unknown };
}): { client: SupabaseClient; upsert: ReturnType<typeof vi.fn> } {
  const upsert = vi.fn(() => ({
    select: vi.fn(() => thenable(options.upsertResult)),
  }));
  const mappingResult = options.mappingResult ?? {
    data: MAPPING_ROW,
    error: null,
  };
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({
      ...thenable(options.listResult),
      maybeSingle: async () => mappingResult,
    })),
  }));
  return {
    client: {
      from: vi.fn(() => ({ upsert, select })),
    } as unknown as SupabaseClient,
    upsert,
  };
}

describe('recordInterestPayout', () => {
  it('credits the reconciled net on first delivery', async () => {
    const { client, upsert } = mockSupabase({
      upsertResult: {
        data: [{ provider_payout_id: 'faas-interest-synthetic-001' }],
        error: null,
      },
    });

    await expect(recordInterestPayout(client, interestEvent)).resolves.toBe(
      'credited'
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_payout_id: 'faas-interest-synthetic-001',
        gross_kobo: 100000,
        withholding_tax_kobo: 5000,
        net_kobo: 95000,
        batch_id: 'batch-synthetic-001',
      }),
      { onConflict: 'provider_payout_id', ignoreDuplicates: true }
    );
  });

  it('collapses redeliveries on the provider payout identity', async () => {
    const { client } = mockSupabase({
      upsertResult: { data: [], error: null },
    });

    await expect(recordInterestPayout(client, interestEvent)).resolves.toBe(
      'duplicate'
    );
  });

  it('fails closed when gross minus tax disagrees with net', async () => {
    const { client } = mockSupabase({
      upsertResult: { data: [], error: null },
    });
    const bad = {
      ...interestEvent,
      eventData: {
        ...interestEvent.eventData,
        break_down: {
          gross_interest_payout: 100000,
          withholding_tax: 4000,
          net_interest_payout: 95000,
        },
      },
    };

    const error = await recordInterestPayout(client, bad).catch(
      (cause: unknown) => cause
    );

    expect(error).toBeInstanceOf(InterestLedgerError);
    expect(error).toMatchObject({ code: 'INTEREST_LEDGER_INCONSISTENT' });
  });

  it('fails closed when the envelope amount disagrees with net', async () => {
    const { client } = mockSupabase({
      upsertResult: { data: [], error: null },
    });
    const bad = {
      ...interestEvent,
      eventData: { ...interestEvent.eventData, amount: 96000 },
    };

    await expect(recordInterestPayout(client, bad)).rejects.toMatchObject({
      code: 'INTEREST_LEDGER_INCONSISTENT',
    });
  });

  it('fails retryable without credit when the wallet is unmapped', async () => {
    const { client, upsert } = mockSupabase({
      upsertResult: { data: [], error: null },
      mappingResult: { data: null, error: null },
    });

    await expect(
      recordInterestPayout(client, interestEvent)
    ).rejects.toMatchObject({ code: 'INTEREST_LEDGER_UNMAPPED' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('fails retryable without credit on a customer mismatch', async () => {
    const { client, upsert } = mockSupabase({
      upsertResult: { data: [], error: null },
      mappingResult: {
        data: { ...MAPPING_ROW, piggyvest_customer_id: 'other-customer' },
        error: null,
      },
    });

    await expect(
      recordInterestPayout(client, interestEvent)
    ).rejects.toMatchObject({ code: 'INTEREST_LEDGER_UNMAPPED' });
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('sumPaidInterestKobo', () => {
  it('sums net payouts for the wallet', async () => {
    const { client } = mockSupabase({
      listResult: {
        data: [{ net_kobo: 95000 }, { net_kobo: 5000 }],
        error: null,
      },
    });

    await expect(
      sumPaidInterestKobo(client, 'pvb-wallet-synthetic-002')
    ).resolves.toBe(100000);
  });

  it('rejects invalid ledger rows instead of partial sums', async () => {
    const { client } = mockSupabase({
      listResult: { data: [{ net_kobo: -5 }], error: null },
    });

    await expect(
      sumPaidInterestKobo(client, 'pvb-wallet-synthetic-002')
    ).rejects.toMatchObject({ code: 'INTEREST_LEDGER_STORAGE_ERROR' });
  });
});

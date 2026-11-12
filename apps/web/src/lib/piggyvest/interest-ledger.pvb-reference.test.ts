import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { InterestPayoutSuccessEvent } from '@/schemas/piggyvest/events';
import { recordInterestPayout } from './interest-ledger';

// PiggyVest (2026-11-11): pvb_reference is a credit's unique key; the
// eventData internals are audit-only and may drift across retries.

const WALLET = 'faas-wallet-synthetic-001';

function payout(
  overrides: Partial<InterestPayoutSuccessEvent['eventData']> & {
    eventId?: string;
    pvbReference?: string;
  } = {}
): InterestPayoutSuccessEvent {
  const { eventId, pvbReference, ...data } = overrides;
  return {
    eventId: eventId ?? 'evt-interest-001',
    eventType: 'interest-payout.success',
    eventCategory: 'interest-payout',
    customer_id: 'faas-customer-synthetic-001',
    eventData: {
      id: 'payout-internal-001',
      amount: 95000,
      destination_wallet: 'pvb-internal-wallet-synthetic-009',
      destination_wallet_balance: 1095000,
      destination_wallet_ledger_balance: 1095000,
      reference: 'ref-001',
      timestamp: '2026-11-11T00:05:00.000Z',
      batch_id: 'batch-001',
      break_down: {
        gross_interest_payout: 100000,
        withholding_tax: 5000,
        net_interest_payout: 95000,
      },
      ...data,
    },
    pvb_reference: pvbReference ?? 'PVB01INTEREST001',
    pvb_wallet: WALLET,
    pvb_accrued_interest_wallet: 'pvb-accrued-wallet-001',
    pvb_destination_wallet: null,
    pvb_third_party_reference: null,
  };
}

type Row = Record<string, unknown>;

/** Ledger enforcing both unique keys, insert-or-ignore, like the migration. */
function fakeLedger() {
  const rows: Row[] = [];
  const find = (column: string, value: unknown) =>
    rows.find((row) => row[column] === value && value !== null) ?? null;
  const client = {
    rpc: async () => ({ data: [], error: null }),
    from: (table: string) => ({
      upsert: (values: Row) => ({
        select: async () => {
          if (
            find('pvb_reference', values.pvb_reference) ||
            find('provider_payout_id', values.provider_payout_id)
          )
            return { data: [], error: null };
          rows.push(values);
          return { data: [values], error: null };
        },
      }),
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () =>
            table === 'piggyvest_plan_wallets'
              ? {
                  data:
                    value === WALLET
                      ? {
                          customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
                          merchant_id: '43e157b6-179c-432a-9392-e0827da96d82',
                          piggyvest_customer_id: 'faas-customer-synthetic-001',
                          wallet_id: WALLET,
                          status: 'ready',
                        }
                      : null,
                  error: null,
                }
              : { data: find(column, value), error: null },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, rows };
}

describe('interest payouts deduped on pvb_reference', () => {
  it('credits once when a retry changes the internal id, batch, reference and timestamp', async () => {
    const alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, rows } = fakeLedger();

    const outcomes = [
      await recordInterestPayout(client, payout()),
      await recordInterestPayout(
        client,
        payout({
          eventId: 'evt-interest-002',
          id: 'payout-internal-002',
          batch_id: 'batch-002',
          reference: 'ref-002',
          timestamp: '2026-11-11T01:00:00.000Z',
        })
      ),
    ];

    expect(outcomes).toEqual(['credited', 'duplicate']);
    expect(rows).toHaveLength(1);
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining(
        'audit fields differ: provider_payout_id, reference, batch_id, paid_at'
      )
    );
    alerts.mockRestore();
  });

  it('quarantines a different pvb_reference that reuses an internal payout id', async () => {
    const { client, rows } = fakeLedger();
    await recordInterestPayout(client, payout());

    await expect(
      recordInterestPayout(
        client,
        payout({ eventId: 'evt-interest-003', pvbReference: 'PVB01OTHER' })
      )
    ).rejects.toMatchObject({
      code: 'INTEREST_LEDGER_CONFLICT',
      conflict: { mismatchedFields: ['pvb_reference'] },
    });
    expect(rows).toHaveLength(1);
  });

  it('still quarantines a same-reference retry whose net amount changed', async () => {
    const { client } = fakeLedger();
    await recordInterestPayout(client, payout());

    await expect(
      recordInterestPayout(
        client,
        payout({
          eventId: 'evt-interest-004',
          amount: 94000,
          break_down: {
            gross_interest_payout: 99000,
            withholding_tax: 5000,
            net_interest_payout: 94000,
          },
        })
      )
    ).rejects.toMatchObject({ code: 'INTEREST_LEDGER_CONFLICT' });
  });
});

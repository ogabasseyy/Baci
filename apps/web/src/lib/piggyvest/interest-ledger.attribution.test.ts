import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { InterestPayoutSuccessEvent } from '@/schemas/piggyvest/events';
import { recordInterestPayout } from './interest-ledger';

// PiggyVest confirmed on 2026-11-11 that interest-payout.success credits the
// envelope pvb_wallet, while eventData.destination_wallet is PVB's internal
// wallet id. Attributing to destination_wallet left every real payout
// INTEREST_LEDGER_UNMAPPED (503, retried until PiggyVest gave up).

const MAPPED_WALLET = 'faas-wallet-synthetic-001';
const PVB_INTERNAL_WALLET = 'pvb-internal-wallet-synthetic-009';

const payout: InterestPayoutSuccessEvent = {
  eventId: '01K8TESTINTEREST101',
  eventType: 'interest-payout.success',
  eventCategory: 'interest-payout',
  customer_id: 'faas-customer-synthetic-001',
  eventData: {
    id: 'faas-interest-synthetic-101',
    amount: 95000,
    destination_wallet: PVB_INTERNAL_WALLET,
    destination_wallet_balance: 1095000,
    destination_wallet_ledger_balance: 1095000,
    reference: 'faas-ref-synthetic-101',
    timestamp: '2026-11-11T00:05:00.000Z',
    batch_id: 'batch-synthetic-101',
    break_down: {
      gross_interest_payout: 100000,
      withholding_tax: 5000,
      net_interest_payout: 95000,
    },
  },
  pvb_reference: 'PVB01SYNTHETIC101',
  pvb_wallet: MAPPED_WALLET,
  pvb_accrued_interest_wallet: 'pvb-accrued-wallet-synthetic-101',
  pvb_destination_wallet: null,
  pvb_third_party_reference: null,
};

/** Plan-wallet table that knows only MAPPED_WALLET, like production. */
function mappedOnly() {
  const upsert = vi.fn(() => ({
    select: vi.fn(async () => ({
      data: [{ provider_payout_id: payout.eventData.id }],
      error: null,
    })),
  }));
  const lookups: string[] = [];
  const client = {
    from: vi.fn((table: string) =>
      table === 'piggyvest_plan_wallets'
        ? {
            select: () => ({
              eq: (_column: string, walletId: string) => {
                lookups.push(walletId);
                return {
                  maybeSingle: async () => ({
                    data:
                      walletId === MAPPED_WALLET
                        ? {
                            customer_id: 'c0065070-dc32-45d2-9c01-871a27abfd10',
                            merchant_id: '43e157b6-179c-432a-9392-e0827da96d82',
                            piggyvest_customer_id: payout.customer_id,
                            wallet_id: MAPPED_WALLET,
                            status: 'ready',
                          }
                        : null,
                    error: null,
                  }),
                };
              },
            }),
          }
        : { upsert }
    ),
    // Staging-bridge fallback consulted for unmapped wallets: no row.
    rpc: vi.fn(async () => ({ data: [], error: null })),
  } as unknown as SupabaseClient;
  return { client, upsert, lookups };
}

describe('bugfix: interest payout attributed to PVB-internal destination_wallet', () => {
  it('credits the payout to the mapped plan wallet named by pvb_wallet', async () => {
    const { client, upsert, lookups } = mappedOnly();

    const outcome = await recordInterestPayout(client, payout);

    expect(outcome).toBe('credited');
    expect(lookups).toEqual([MAPPED_WALLET]);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ wallet_id: MAPPED_WALLET, net_kobo: 95000 }),
      expect.anything()
    );
  });

  it('does not credit when only the old destination_wallet value is mapped', async () => {
    // Arrange: the pre-fix attribution key carries the mapped wallet, the
    // credited pvb_wallet does not.
    const { client, upsert, lookups } = mappedOnly();
    const legacy = {
      ...payout,
      pvb_wallet: 'pvb-unmapped-wallet-synthetic-404',
      eventData: { ...payout.eventData, destination_wallet: MAPPED_WALLET },
    };

    const outcome = recordInterestPayout(client, legacy);

    await expect(outcome).rejects.toMatchObject({
      code: 'INTEREST_LEDGER_UNMAPPED',
    });
    expect(lookups).toEqual(['pvb-unmapped-wallet-synthetic-404']);
    expect(upsert).not.toHaveBeenCalled();
  });
});

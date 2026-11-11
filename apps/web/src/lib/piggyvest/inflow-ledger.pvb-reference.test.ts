import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { BankTransferInflowSuccessEvent } from '@/schemas/piggyvest/events';
import { recordInflowCredit } from './inflow-ledger';

// PiggyVest confirmed on 2026-11-11 that a credit's unique key is the
// envelope pvb_reference; eventData.transaction_id is internal-only and may
// not match across deliveries of the same credit.

const WALLET = 'pvb-wallet-synthetic-001';

function delivery(
  overrides: {
    eventId?: string;
    pvbReference?: string;
    transactionId?: string;
  } = {}
): BankTransferInflowSuccessEvent {
  return {
    eventId: overrides.eventId ?? 'evt-synthetic-001',
    eventType: 'bank-transfer.inflow.success',
    eventCategory: 'inflow_transaction',
    customer_id: 'faas-customer-synthetic-001',
    eventData: {
      id: 'faas-data-synthetic-001',
      customer_id: 'faas-customer-synthetic-001',
      source_wallet_id: '',
      destination_wallet_id: 'pvb-internal-wallet-synthetic-009',
      type: 'inflow',
      category: 'bank_transfer_inflow',
      amount: 1750000,
      currency: 'NGN',
      narration: 'Transfer from SYNTHETIC SENDER',
      ip_address: '',
      transaction_id: overrides.transactionId ?? 'internal-txn-synthetic-001',
      timestamp: '2026-11-11T10:12:00.000Z',
      status: 'success',
      third_party_reference: 'synthetic-third-party-ref',
      initiator_reference: 'synthetic-initiator-ref',
      internal_reference: 'synthetic-internal-ref',
      attempts: 1,
      provider: 'wema',
      destination_wallet_balance: 5000000,
      destination_wallet_ledger_balance: 5000000,
      destination_transaction_balance: 5000000,
      reference: 'faas-ref-synthetic-001',
      recipient_bank_account_number: '9000000001',
      recipient_bank_account_name: 'SYNTHETIC LTD',
      sender_bank_account_number: '0000000001',
      sender_bank_name: 'Synthetic Bank',
      sender_name: 'SYNTHETIC SENDER',
      session_id: '000000000001',
      fee: 0,
    },
    pvb_reference: overrides.pvbReference ?? 'PVB01SYNTHETIC001',
    pvb_wallet: WALLET,
  };
}

type Row = Record<string, unknown>;

/**
 * In-memory ledger with the migration's constraints: unique pvb_reference
 * (NULLs distinct) and unique provider_transaction_id, insert-or-ignore.
 */
function fakeLedger(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  const rpc = vi.fn(async () => ({ data: [], error: null }));
  const find = (column: string, value: unknown) =>
    rows.find((row) => row[column] === value && value !== null) ?? null;
  const client = {
    rpc,
    from: (table: string) => ({
      upsert: (values: Row) => ({
        select: async () => {
          const collides =
            find('pvb_reference', values.pvb_reference) ||
            find('provider_transaction_id', values.provider_transaction_id);
          if (collides) return { data: [], error: null };
          rows.push(values);
          return {
            data: [{ pvb_reference: values.pvb_reference }],
            error: null,
          };
        },
      }),
      select: () => ({
        eq: (column: string, value: unknown) => ({
          maybeSingle: async () => {
            if (table === 'piggyvest_plan_wallets')
              return {
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
              };
            return { data: find(column, value), error: null };
          },
        }),
      }),
    }),
  } as unknown as SupabaseClient;
  return { client, rows, rpc };
}

describe('bugfix: inflow credits deduped on internal transaction_id', () => {
  it('credits once when two deliveries share pvb_reference but differ in transaction_id', async () => {
    // Arrange
    const alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, rows, rpc } = fakeLedger();
    const first = delivery();
    const retry = delivery({
      eventId: 'evt-synthetic-002',
      transactionId: 'internal-txn-synthetic-002',
    });

    // Act
    const outcomes = [
      await recordInflowCredit(client, first),
      await recordInflowCredit(client, retry),
    ];

    // Assert: one credit, and both projections use the first writer's key
    // so the plan-transfer RPC dedupes instead of rejecting or doubling.
    expect(outcomes).toEqual(['credited', 'duplicate']);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pvb_reference: 'PVB01SYNTHETIC001',
      provider_transaction_id: 'internal-txn-synthetic-001',
    });
    // The drifted internal id is paged by name, never silently acked.
    expect(alerts).toHaveBeenCalledWith(
      expect.stringContaining(
        'PIGGYVEST_CREDIT_AUDIT_DRIFT {"reason":"same pvb_reference, audit fields differ: provider_transaction_id"'
      )
    );
    alerts.mockRestore();
    expect(rpc).toHaveBeenCalledTimes(2);
    for (const [, args] of rpc.mock.calls as unknown as [string, Row][]) {
      expect(args).toMatchObject({
        p_provider_transaction_id: 'internal-txn-synthetic-001',
        p_idempotency_key: 'plan-transfer:internal-txn-synthetic-001',
      });
    }
  });

  it('treats a pre-migration row (null pvb_reference) as the same credit by its legacy key', async () => {
    const { client, rows } = fakeLedger();
    await recordInflowCredit(client, delivery());
    rows[0] = { ...rows[0], pvb_reference: null };

    await expect(
      recordInflowCredit(client, delivery({ eventId: 'evt-synthetic-003' }))
    ).resolves.toBe('duplicate');
    expect(rows).toHaveLength(1);
  });

  it("quarantines a new pvb_reference reusing a legacy row's internal id when its audit fields differ", async () => {
    // Legacy row (no pvb_reference, matched by internal id only): keep the
    // strict pre-change comparison instead of calling it a duplicate.
    const { client, rows } = fakeLedger();
    await recordInflowCredit(client, delivery());
    rows[0] = { ...rows[0], pvb_reference: null };
    const other = delivery({
      eventId: 'evt-synthetic-007',
      pvbReference: 'PVB01OTHERCREDIT',
    });
    other.eventData = { ...other.eventData, reference: 'faas-ref-other' };

    await expect(recordInflowCredit(client, other)).rejects.toMatchObject({
      code: 'INFLOW_LEDGER_CONFLICT',
      conflict: { mismatchedFields: ['reference'] },
    });
    expect(rows).toHaveLength(1);
  });

  it('quarantines a different pvb_reference that reuses an internal transaction_id', async () => {
    const { client, rows } = fakeLedger();
    await recordInflowCredit(client, delivery());

    await expect(
      recordInflowCredit(
        client,
        delivery({ eventId: 'evt-synthetic-004', pvbReference: 'PVB01OTHER' })
      )
    ).rejects.toMatchObject({
      code: 'INFLOW_LEDGER_CONFLICT',
      conflict: { mismatchedFields: ['pvb_reference'] },
    });
    expect(rows).toHaveLength(1);
  });

  it("quarantines a known pvb_reference arriving with another credit's internal id", async () => {
    // Stored A/txn-1 and B/txn-2; incoming A/txn-2.
    const { client, rows } = fakeLedger();
    await recordInflowCredit(client, delivery());
    await recordInflowCredit(
      client,
      delivery({
        eventId: 'evt-synthetic-005',
        pvbReference: 'PVB01SYNTHETIC002',
        transactionId: 'internal-txn-synthetic-002',
      })
    );

    await expect(
      recordInflowCredit(
        client,
        delivery({
          eventId: 'evt-synthetic-006',
          transactionId: 'internal-txn-synthetic-002',
        })
      )
    ).rejects.toMatchObject({
      code: 'INFLOW_LEDGER_CONFLICT',
      conflict: { mismatchedFields: ['provider_transaction_id'] },
    });
    expect(rows).toHaveLength(2);
  });

  it('writes pvb_reference on every new credit', async () => {
    const { client, rows } = fakeLedger();
    await recordInflowCredit(client, delivery({ pvbReference: 'PVB01NEW' }));
    expect(rows[0]).toMatchObject({ pvb_reference: 'PVB01NEW' });
  });
});

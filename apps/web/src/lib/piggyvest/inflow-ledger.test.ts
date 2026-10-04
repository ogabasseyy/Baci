import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { BankTransferInflowSuccessEvent } from '@/schemas/piggyvest/events';
import { InflowLedgerError, recordInflowCredit } from './inflow-ledger';

const inflowEvent: BankTransferInflowSuccessEvent = {
  eventId: '01K8TESTINFLOW001',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'bank-transfer',
  customer_id: 'faas-customer-synthetic-001',
  eventData: {
    id: 'faas-txn-synthetic-001',
    customer_id: 'faas-customer-synthetic-001',
    source_wallet_id: '',
    destination_wallet_id: 'faas-wallet-synthetic-001',
    type: 'inflow',
    category: 'bank_transfer_inflow',
    amount: 1750000,
    currency: 'NGN',
    narration: 'Transfer from SYNTHETIC SENDER',
    ip_address: '',
    transaction_id: 'provider-txn-synthetic-001',
    timestamp: '2026-09-15T10:12:00.000Z',
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
  pvb_reference: 'pvb-txn-synthetic-001',
  pvb_wallet: 'pvb-wallet-synthetic-001',
  pvb_destination_wallet: null,
  pvb_third_party_reference: null,
  pvb_schedule_payment_id: null,
  pvb_destination_account_creation_reference: null,
  pvb_meta: null,
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
  wallet_id: 'pvb-wallet-synthetic-001',
  status: 'ready',
};

const STORED_CREDIT_ROW = {
  customer_id: 'faas-customer-synthetic-001',
  wallet_id: 'pvb-wallet-synthetic-001',
  amount_kobo: 1750000,
  fee_kobo: 0,
  reference: 'faas-ref-synthetic-001',
  session_id: '000000000001',
};

function mockSupabase(
  upsertResult: { data: unknown; error: unknown },
  mappingResult: { data: unknown; error: unknown } = {
    data: MAPPING_ROW,
    error: null,
  },
  verifyResult: { data: unknown; error: unknown } = {
    data: STORED_CREDIT_ROW,
    error: null,
  }
): {
  client: SupabaseClient;
  upsert: ReturnType<typeof vi.fn>;
} {
  const upsert = vi.fn(() => ({
    select: vi.fn(() => thenable(upsertResult)),
  }));
  const select = vi.fn(() => ({
    eq: vi.fn(() => ({ maybeSingle: async () => mappingResult })),
  }));
  const verifySelect = vi.fn(() => ({
    eq: vi.fn(() => ({ maybeSingle: async () => verifyResult })),
  }));
  return {
    client: {
      from: vi.fn((table: string) =>
        table === 'piggyvest_plan_wallets'
          ? { select }
          : { upsert, select: verifySelect }
      ),
    } as unknown as SupabaseClient,
    upsert,
  };
}

describe('recordInflowCredit', () => {
  it('credits the confirmed amount on first delivery', async () => {
    const { client, upsert } = mockSupabase({
      data: [{ provider_transaction_id: 'provider-txn-synthetic-001' }],
      error: null,
    });

    await expect(recordInflowCredit(client, inflowEvent)).resolves.toBe(
      'credited'
    );
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        provider_transaction_id: 'provider-txn-synthetic-001',
        wallet_id: 'pvb-wallet-synthetic-001',
        amount_kobo: 1750000,
        fee_kobo: 0,
        session_id: '000000000001',
      }),
      { onConflict: 'provider_transaction_id', ignoreDuplicates: true }
    );
    const persisted = upsert.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(persisted).not.toHaveProperty('sender_name');
    expect(persisted).not.toHaveProperty('sender_bank_account_number');
    expect(persisted).not.toHaveProperty('recipient_bank_account_number');
  });

  it('collapses redeliveries on the provider transaction identity', async () => {
    const { client } = mockSupabase({ data: [], error: null });

    await expect(recordInflowCredit(client, inflowEvent)).resolves.toBe(
      'duplicate'
    );
  });

  it('fails closed on zero-amount inflows without touching storage', async () => {
    const { client } = mockSupabase({ data: [], error: null });
    const bad = {
      ...inflowEvent,
      eventData: { ...inflowEvent.eventData, amount: 0 },
    };

    const error = await recordInflowCredit(client, bad).catch(
      (cause: unknown) => cause
    );

    expect(error).toBeInstanceOf(InflowLedgerError);
    expect(error).toMatchObject({ code: 'INFLOW_LEDGER_INVALID' });
    expect(client.from).not.toHaveBeenCalled();
  });

  it('fails retryable without credit when the wallet is unmapped', async () => {
    const { client, upsert } = mockSupabase(
      { data: [], error: null },
      { data: null, error: null }
    );

    const error = await recordInflowCredit(client, inflowEvent).catch(
      (cause: unknown) => cause
    );

    expect(error).toBeInstanceOf(InflowLedgerError);
    expect(error).toMatchObject({ code: 'INFLOW_LEDGER_UNMAPPED' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('fails retryable without credit on a customer mismatch', async () => {
    const { client, upsert } = mockSupabase(
      { data: [], error: null },
      {
        data: { ...MAPPING_ROW, piggyvest_customer_id: 'other-customer' },
        error: null,
      }
    );

    const error = await recordInflowCredit(client, inflowEvent).catch(
      (cause: unknown) => cause
    );

    expect(error).toBeInstanceOf(InflowLedgerError);
    expect(error).toMatchObject({ code: 'INFLOW_LEDGER_UNMAPPED' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects conduit-only attribution without credit', async () => {
    // The nested destination id may match a row while pvb_wallet does
    // not: the conduit is never an attribution substitute.
    const { client, upsert } = mockSupabase(
      { data: [], error: null },
      { data: null, error: null }
    );
    const conduitEvent = {
      ...inflowEvent,
      pvb_wallet: 'pvb-wallet-unknown-001',
    };

    const error = await recordInflowCredit(client, conduitEvent).catch(
      (cause: unknown) => cause
    );

    expect(error).toBeInstanceOf(InflowLedgerError);
    expect(error).toMatchObject({ code: 'INFLOW_LEDGER_UNMAPPED' });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('stores a null session when the provider omits it', async () => {
    const { client, upsert } = mockSupabase({
      data: [{ provider_transaction_id: 'provider-txn-synthetic-001' }],
      error: null,
    });
    const { session_id: _omitted, ...dataWithoutSession } =
      inflowEvent.eventData;

    await expect(
      recordInflowCredit(client, {
        ...inflowEvent,
        eventData: dataWithoutSession,
      })
    ).resolves.toBe('credited');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: null }),
      expect.anything()
    );
  });

  it('raises a conflict when a redelivery changes the financials', async () => {
    const { client } = mockSupabase(
      { data: [], error: null },
      { data: MAPPING_ROW, error: null },
      {
        data: { ...STORED_CREDIT_ROW, amount_kobo: 999 },
        error: null,
      }
    );

    const error = await recordInflowCredit(client, inflowEvent).catch(
      (cause: unknown) => cause
    );

    expect(error).toBeInstanceOf(InflowLedgerError);
    expect(error).toMatchObject({
      code: 'INFLOW_LEDGER_CONFLICT',
      conflict: {
        providerTransactionId: 'provider-txn-synthetic-001',
        mismatchedFields: ['amount_kobo'],
      },
    });
    expect(
      (error as InflowLedgerError).conflict?.bodyDigest
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  it('names every mismatched field in a multi-field conflict', async () => {
    const { client } = mockSupabase(
      { data: [], error: null },
      { data: MAPPING_ROW, error: null },
      {
        data: {
          ...STORED_CREDIT_ROW,
          wallet_id: 'pvb-wallet-other-001',
          reference: 'other-ref',
        },
        error: null,
      }
    );

    const error = await recordInflowCredit(client, inflowEvent).catch(
      (cause: unknown) => cause
    );

    expect(error).toMatchObject({
      code: 'INFLOW_LEDGER_CONFLICT',
      conflict: { mismatchedFields: ['wallet_id', 'reference'] },
    });
  });

  it('fails storage-error when the duplicate verify read fails', async () => {
    const { client } = mockSupabase(
      { data: [], error: null },
      { data: MAPPING_ROW, error: null },
      { data: null, error: { message: 'db down' } }
    );

    const error = await recordInflowCredit(client, inflowEvent).catch(
      (cause: unknown) => cause
    );

    expect(error).toMatchObject({ code: 'INFLOW_LEDGER_STORAGE_ERROR' });
  });
});

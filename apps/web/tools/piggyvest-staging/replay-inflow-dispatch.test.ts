import { describe, expect, it, vi } from 'vitest';
import { dispatchReplayInflow } from './replay-inflow-dispatch';
import type { StoreRpc } from './replay-store';
import { DispatchQuarantine } from './replay-worker';

const event = {
  eventId: 'evt-001',
  eventType: 'bank-transfer.inflow.success',
  eventCategory: 'inflow_transaction',
  customer_id: 'provider-customer-001',
  eventData: {
    id: 'event-data-001',
    customer_id: 'provider-customer-001',
    destination_wallet_id: 'conduit-001',
    type: 'inter',
    category: 'bank_transfer_inflow',
    amount: 10000,
    currency: 'NGN',
    narration: 'synthetic',
    ip_address: '127.0.0.1',
    transaction_id: 'transaction-001',
    timestamp: '2026-09-18T17:57:47.566Z',
    status: 'COMPLETED',
    third_party_reference: 'third-party-001',
    initiator_reference: 'initiator-001',
    internal_reference: 'internal-001',
    provider: 'FAAS',
    destination_wallet_balance: 10000,
    destination_wallet_ledger_balance: 10000,
    destination_transaction_balance: 10000,
    reference: 'reference-001',
    fee: 0,
  },
  pvb_reference: 'pvb-reference-001',
  pvb_wallet: 'api-wallet-001',
} as const;

function rpcReturning(value: unknown): StoreRpc {
  return { call: vi.fn(async () => value) as StoreRpc['call'] };
}

describe('replay inflow dispatch RPC adapter', () => {
  it('maps recognized to applied and sends exact fields with null session', async () => {
    const store = rpcReturning('recognized');

    await expect(dispatchReplayInflow(store, event)).resolves.toBe('applied');
    expect(store.call).toHaveBeenCalledWith(
      'recognize_piggyvest_staging_inflow',
      {
        p_provider_transaction_id: 'transaction-001',
        p_event_data_id: 'event-data-001',
        p_event_id: 'evt-001',
        p_provider_customer_id: 'provider-customer-001',
        p_wallet_id: 'api-wallet-001',
        p_amount_kobo: 10000,
        p_fee_kobo: 0,
        p_reference: 'reference-001',
        p_session_id: null,
        p_credited_at: '2026-09-18T17:57:47.566Z',
      }
    );
  });

  it('maps duplicate to duplicate', async () => {
    await expect(
      dispatchReplayInflow(rpcReturning('duplicate'), event)
    ).resolves.toBe('duplicate');
  });

  it.each([
    ['23505', 'conflict'],
    ['22023', 'poison'],
  ] as const)('quarantines SQLSTATE %s as %s', async (code, reason) => {
    const error = Object.assign(new Error('rpc failed'), { code });
    const rejection = dispatchReplayInflow(
      {
        call: vi.fn(async () => {
          throw error;
        }),
      },
      event
    );

    await expect(rejection).rejects.toMatchObject({
      eventId: 'evt-001',
      reason,
    });
    await expect(rejection).rejects.toBeInstanceOf(DispatchQuarantine);
  });

  it('rethrows 23503 for the retryable path', async () => {
    const error = Object.assign(new Error('mapping unavailable'), {
      code: '23503',
    });

    await expect(
      dispatchReplayInflow(
        {
          call: vi.fn(async () => {
            throw error;
          }),
        },
        event
      )
    ).rejects.toBe(error);
  });

  it('quarantines an unexpected RPC outcome as poison', async () => {
    await expect(
      dispatchReplayInflow(rpcReturning('credited'), event)
    ).rejects.toMatchObject({
      reason: 'poison',
      eventId: 'evt-001',
    });
  });
});

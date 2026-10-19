import { describe, expect, it, vi } from 'vitest';
import { adapters, key, lease } from './replay-test-fixtures';
import { createReplayWorker } from './replay-worker';

const interest = {
  eventId: 'interest-1',
  eventType: 'interest-payout.success',
  eventCategory: 'interest-payout',
  customer_id: 'provider-customer',
  pvb_wallet: 'not-the-interest-source',
  pvb_accrued_interest_wallet: 'source',
  pvb_destination_wallet: null,
  pvb_third_party_reference: null,
  pvb_reference: 'reference',
  eventData: {
    id: 'payout-1',
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

function sealed(value: unknown) {
  return lease(value as Parameters<typeof lease>[0]);
}

describe('event-specific durable financial replay', () => {
  it('sends paid interest to the financial bridge without incorrectly mapping pvb_wallet', async () => {
    const dispatchFinancial = vi.fn(async () => 'applied' as const);
    const store = adapters({ claimBatch: async () => [sealed(interest)] });
    Object.assign(store, { dispatchFinancial });
    const result = await createReplayWorker(store, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.processed).toBe(1);
    expect(dispatchFinancial).toHaveBeenCalledWith(
      expect.objectContaining({ event: interest })
    );
    expect(store.resolveMapping).not.toHaveBeenCalled();
    expect(store.dispatch).not.toHaveBeenCalled();
  });
  it('defers interest when the isolated financial bridge is not configured', async () => {
    const store = adapters({ claimBatch: async () => [sealed(interest)] });
    const result = await createReplayWorker(store, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.retryable).toBe(1);
    expect(result.processed).toBe(0);
    expect(store.dispatch).not.toHaveBeenCalled();
  });
  it('validates and routes outflow without treating its source as a customer inflow wallet', async () => {
    const outflow = {
      eventId: 'outflow-1',
      eventType: 'wallet-transfer.outflow.success',
      eventCategory: 'outflow',
      customer_id: 'provider-customer',
      eventData: { reference: 'transfer-1' },
    };
    const store = adapters({ claimBatch: async () => [sealed(outflow)] });
    const dispatchFinancial = vi.fn(async () => 'duplicate' as const);
    Object.assign(store, { dispatchFinancial });
    const result = await createReplayWorker(store, {
      environment: 'staging',
      batchSize: 1,
      keyResolver: async () => key,
    }).run();
    expect(result.processed).toBe(1);
    expect(store.resolveMapping).not.toHaveBeenCalled();
    expect(dispatchFinancial).toHaveBeenCalledOnce();
  });
});

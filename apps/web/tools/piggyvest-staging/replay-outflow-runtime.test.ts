import { describe, expect, it, vi } from 'vitest';
import { createOutflowReplay } from './replay-outflow-runtime';

const scope = {
  integrationId: '40000000-0000-4000-8000-000000000001',
  businessId: 'business',
  expectedSystemId: '123',
};
const event = {
  eventId: 'event-1',
  eventType: 'wallet-transfer.outflow.success',
  eventCategory: 'outflow',
  customer_id: 'provider-customer',
  eventData: {
    reference: 'reference',
    amount: 1000,
    currency: 'NGN',
    source_wallet_id: 'source',
    destination_wallet_id: 'destination',
    transaction_id: 'provider-tx',
  },
};
const expected = {
  ...scope,
  customerId: 'c0065070-dc32-45d2-9c01-871a27abfd10',
  providerCustomerId: 'provider-customer',
  reference: 'reference',
  amountKobo: 1000,
  currency: 'NGN',
  sourceWalletId: 'source',
  destinationWalletId: 'destination',
  direction: 'wallet',
  status: 'submitted',
} as const;
function store() {
  return {
    findExpected: vi.fn(async () => expected),
    compareAndSetTerminal: vi.fn(async () => 'applied' as const),
  };
}
describe('outflow replay runtime', () => {
  it('correlates a fully identified wallet transfer before accepting durable finality', async () => {
    const durable = store();
    await expect(createOutflowReplay(scope, durable)(event)).resolves.toBe(
      'applied'
    );
    expect(durable.findExpected).toHaveBeenCalledWith({
      reference: 'reference',
      providerCustomerId: 'provider-customer',
    });
    expect(durable.compareAndSetTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        evidence: expect.objectContaining({
          providerTransactionId: 'provider-tx',
        }),
        terminalStatus: 'succeeded',
      })
    );
  });
  it('defers incomplete or bank destination evidence rather than guessing', async () => {
    const durable = store();
    await expect(
      createOutflowReplay(
        scope,
        durable
      )({ ...event, eventData: { reference: 'reference' } })
    ).rejects.toThrow('Outflow replay deferred');
    await expect(
      createOutflowReplay(
        scope,
        durable
      )({ ...event, eventType: 'bank-transfer.outflow.success' })
    ).rejects.toThrow('Outflow replay deferred');
    expect(durable.compareAndSetTerminal).not.toHaveBeenCalled();
  });
  it('quarantines contradictory source wallets without writing', async () => {
    const durable = store();
    await expect(
      createOutflowReplay(
        scope,
        durable
      )({
        ...event,
        eventData: { ...event.eventData, source_wallet_id: 'wrong' },
      })
    ).rejects.toMatchObject({ reason: 'conflict' });
    expect(durable.compareAndSetTerminal).not.toHaveBeenCalled();
  });
  it('does not call success when SQL sees an opposite terminal result', async () => {
    const durable = store();
    durable.compareAndSetTerminal.mockResolvedValue(
      'terminal-conflict' as never
    );
    await expect(
      createOutflowReplay(scope, durable)(event)
    ).rejects.toMatchObject({ reason: 'conflict' });
  });
});

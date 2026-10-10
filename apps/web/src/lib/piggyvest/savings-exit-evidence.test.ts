import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createSavingsExitEvidence } from './savings-exit-evidence';

const reference = '30000000-0000-4000-8000-000000004212';
const configuration = {
  integrationId: '40000000-0000-4000-8000-000000000001',
  expectedBusinessId: 'synthetic-business',
  webhookSecret: 'synthetic-exit-signature',
  apiSecret: 'synthetic-exit-api',
};
const event = {
  eventId: 'exit-event-1',
  customer_id: 'source-customer',
  eventType: 'wallet-transfer.outflow.success',
  pvb_reference: 'transaction-1',
  pvb_wallet: 'source-wallet',
};
const transaction = {
  id: 'transaction-1',
  customer_id: 'source-customer',
  source_wallet: 'source-wallet',
  destination_wallet: 'destination-wallet',
  reference,
  category: 'wallet_transfer',
  status: 'successful',
  amount: 99150,
  fee: 0,
};

function harness(
  changes: Record<string, unknown> = {},
  wallets: Record<string, Record<string, unknown>> = {}
) {
  const execute = vi.fn(async () => ({
    rows: [{ result: { state: 'stored' } }],
  }));
  const fetchImplementation = vi.fn(async (url: string | URL | Request) => {
    const address = String(url);
    const data = address.includes('/wallet/')
      ? {
          id: address.split('/').at(-1),
          business_id: 'synthetic-business',
          currency: 'NGN',
          status: 'active',
          ...wallets[address.split('/').at(-1) ?? ''],
        }
      : address.includes('/verify?')
        ? { reference, amount: 99150, status: 'success' }
        : { ...transaction, ...changes };
    return new Response(JSON.stringify({ status: true, data }));
  });
  const adapter = createSavingsExitEvidence({
    configuration,
    execute,
    fetchImplementation,
  });
  const rawPayload = Buffer.from(JSON.stringify(event));
  const signature = createHmac('sha512', configuration.webhookSecret)
    .update(rawPayload)
    .digest('hex');
  return {
    execute,
    fetchImplementation,
    adapter,
    input: { rawPayload, signature },
  };
}

describe('savings exit independently authenticated evidence', () => {
  it.each([
    'source-wallet',
    'destination-wallet',
  ])('requires independently returned business/currency for %s', async (walletId) => {
    for (const changes of [
      { currency: 'USD' },
      { currency: undefined },
      { business_id: 'other' },
      { business_id: undefined },
      { id: 'other' },
    ]) {
      const test = harness({}, { [walletId]: changes });
      expect(await test.adapter.ingest(test.input)).toEqual({
        state: 'deferred',
      });
      expect(test.execute).not.toHaveBeenCalled();
    }
  });
  it('rejects redirects before trusting the provider transaction response', async () => {
    const test = harness();
    const response = new Response(
      JSON.stringify({ status: true, data: transaction })
    );
    Object.defineProperty(response, 'redirected', { value: true });
    test.fetchImplementation.mockResolvedValueOnce(response);
    expect(await test.adapter.ingest(test.input)).toEqual({
      state: 'deferred',
    });
    expect(test.execute).not.toHaveBeenCalled();
    expect(test.fetchImplementation).toHaveBeenCalledOnce();
  });
  it('persists provider lookup evidence without accepting an expected transfer', async () => {
    const test = harness();
    expect(await test.adapter.ingest(test.input)).toEqual({ state: 'stored' });
    expect(test.execute).toHaveBeenCalledOnce();
    expect(test.execute.mock.calls[0]).toEqual([
      expect.stringContaining('record_evidence'),
      [
        configuration.integrationId,
        expect.stringContaining('"amountKobo":99150'),
      ],
    ]);
    expect(test.fetchImplementation).toHaveBeenCalledTimes(4);
  });

  it.each([
    { id: 'other' },
    { customer_id: 'other' },
    { source_wallet: 'other' },
    { status: 'partial' },
    { amount: 1 },
    { fee: -1 },
    { destination_wallet: '' },
  ])('does not fill incomplete or mismatched receipts with request values: %j', async (changes) => {
    const test = harness(changes);
    expect(await test.adapter.ingest(test.input)).toEqual({
      state: 'deferred',
    });
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('rejects forged signatures before any I/O', async () => {
    const test = harness();
    expect(
      await test.adapter.ingest({ ...test.input, signature: '0'.repeat(128) })
    ).toEqual({ state: 'invalid_signature' });
    expect(test.fetchImplementation).not.toHaveBeenCalled();
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('does not accept echoed transfer plus status as independently authenticated evidence', async () => {
    const test = harness();
    const rawPayload = Buffer.from(
      JSON.stringify({ ...transaction, status: 'success' })
    );
    const signature = createHmac('sha512', configuration.webhookSecret)
      .update(rawPayload)
      .digest('hex');
    expect(await test.adapter.ingest({ rawPayload, signature })).toEqual({
      state: 'deferred',
    });
    expect(test.execute).not.toHaveBeenCalled();
  });

  it('defers transport loss and a wrong wallet business without writing evidence', async () => {
    const test = harness();
    test.fetchImplementation.mockRejectedValueOnce(
      new Error('synthetic transport loss')
    );
    expect(await test.adapter.ingest(test.input)).toEqual({
      state: 'deferred',
    });
    test.fetchImplementation.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: true,
          data: {
            ...transaction,
            business_id: 'other',
            currency: 'NGN',
          },
        })
      )
    );
    expect(await test.adapter.ingest(test.input)).toEqual({
      state: 'deferred',
    });
    expect(test.execute).not.toHaveBeenCalled();
  });
});

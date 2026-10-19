import { beforeEach, expect, it, vi } from 'vitest';
import { createPrefundedCardReceiptReplay } from './prefunded-card-receipt-replay';

const mocks = vi.hoisted(() => ({
  ingest: vi.fn(),
  applyInflow: vi.fn(),
  create: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('./prefunded-card-provider-evidence', () => ({
  createPrefundedCardProviderEvidence: mocks.create,
}));

function fixture(eventType = 'bank-transfer.inflow.success') {
  const ingestionExecute = vi.fn();
  const ledgerExecute = vi.fn();
  const configuration = { integrationId: 'fixture' };
  const rawPayload = new TextEncoder().encode(
    JSON.stringify({
      eventId: 'event-1',
      customer_id: 'provider-customer',
      eventType,
      eventCategory: 'inflow_transaction',
      eventData: {},
      pvb_reference: 'PVB-1',
      pvb_wallet: 'wallet-1',
    })
  );
  const replay = createPrefundedCardReceiptReplay({
    configuration,
    ingestionExecute,
    ledgerExecute,
    fetchImplementation: vi.fn(),
  });
  return {
    replay,
    rawPayload,
    ingestionExecute,
    ledgerExecute,
    configuration,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockImplementation(() => ({
    ingest: mocks.ingest,
    applyInflow: mocks.applyInflow,
  }));
  mocks.ingest.mockResolvedValue({ outcome: 'stored' });
  mocks.applyInflow.mockResolvedValue('applied');
});

it('projects only after committed evidence and uses separate writer and ledger executors', async () => {
  const sample = fixture();
  expect(mocks.create.mock.calls[0][0].execute).toBe(sample.ingestionExecute);
  expect(mocks.create.mock.calls[1][0].execute).toBe(sample.ledgerExecute);
  mocks.ingest.mockImplementation(async () => {
    expect(mocks.applyInflow).not.toHaveBeenCalled();
    return { outcome: 'stored' };
  });
  await expect(
    sample.replay({ rawPayload: sample.rawPayload, signature: 'signature' })
  ).resolves.toEqual({ outcome: 'processed', projection: 'applied' });
  expect(mocks.applyInflow).toHaveBeenCalledExactlyOnceWith('event-1');
});

it.each([
  { evidence: 'invalid_signature', outcome: 'rejected' },
  { evidence: 'invalid_payload', outcome: 'rejected' },
  { evidence: 'conflict', outcome: 'reconciliation_required' },
  { evidence: 'deferred', outcome: 'retry' },
])('does not credit after $evidence evidence', async ({
  evidence,
  outcome,
}) => {
  const sample = fixture();
  mocks.ingest.mockResolvedValue({ outcome: evidence });
  expect(
    (
      await sample.replay({
        rawPayload: sample.rawPayload,
        signature: 'signature',
      })
    ).outcome
  ).toBe(outcome);
  expect(mocks.applyInflow).not.toHaveBeenCalled();
});

it('retries attribution after already-stored evidence instead of acknowledging an uncredited receipt', async () => {
  const sample = fixture();
  mocks.ingest.mockResolvedValue({ outcome: 'duplicate' });
  mocks.applyInflow
    .mockResolvedValueOnce('deferred')
    .mockResolvedValueOnce('duplicate');
  const input = { rawPayload: sample.rawPayload, signature: 'signature' };
  await expect(sample.replay(input)).resolves.toEqual({
    outcome: 'retry',
    stage: 'projection',
  });
  await expect(sample.replay(input)).resolves.toEqual({
    outcome: 'processed',
    projection: 'duplicate',
  });
});

it('propagates storage failures rather than acknowledging receipt completion', async () => {
  const sample = fixture();
  mocks.ingest.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(
    sample.replay({ rawPayload: sample.rawPayload, signature: 'signature' })
  ).rejects.toThrow('storage unavailable');
  expect(mocks.applyInflow).not.toHaveBeenCalled();
});

it('keeps transfer evidence out of ordinary bank principal projection', async () => {
  const sample = fixture('wallet-transfer.outflow.success');
  await expect(
    sample.replay({ rawPayload: sample.rawPayload, signature: 'signature' })
  ).resolves.toEqual({ outcome: 'processed', projection: 'not_applicable' });
  expect(mocks.applyInflow).not.toHaveBeenCalled();
});

it('copies raw receipt bytes before asynchronous verification', async () => {
  const sample = fixture();
  mocks.ingest.mockImplementation(async () => {
    sample.rawPayload.fill(0);
    return { outcome: 'stored' };
  });
  await expect(
    sample.replay({ rawPayload: sample.rawPayload, signature: 'signature' })
  ).resolves.toEqual({ outcome: 'processed', projection: 'applied' });
  expect(mocks.applyInflow).toHaveBeenCalledExactlyOnceWith('event-1');
});

it.each([
  new Uint8Array(),
  new Uint8Array(65_537),
  '{}',
])('rejects invalid raw payload without using a credentialed executor', async (rawPayload) => {
  const sample = fixture();
  await expect(
    sample.replay({ rawPayload, signature: 'signature' })
  ).resolves.toEqual({ outcome: 'rejected' });
  expect(mocks.ingest).not.toHaveBeenCalled();
  expect(mocks.applyInflow).not.toHaveBeenCalled();
});

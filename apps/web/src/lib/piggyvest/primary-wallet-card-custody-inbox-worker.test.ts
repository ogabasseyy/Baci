import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from './primary-wallet-card-custody-inbox.test-fixture';
import { createPrimaryCardCustodyInboxWorker } from './primary-wallet-card-custody-inbox-worker';

function setup(overrides?: { configuration?: unknown; claims?: unknown[] }) {
  const execute = vi.fn(async (action: string): Promise<unknown> => {
    if (action === 'inboxReadiness') return fixture.ready;
    if (action === 'inboxClaim') return overrides?.claims ?? [fixture.claim];
    if (action === 'context') return fixture.context;
    if (action === 'settle') return 'completed';
    if (action === 'inboxFinish') return true;
    throw new Error('unexpected action');
  });
  const resolveOperation = vi
    .fn()
    .mockResolvedValue(fixture.context.operationId);
  const observe = vi.fn().mockResolvedValue(fixture);
  const run = createPrimaryCardCustodyInboxWorker({
    configuration: overrides?.configuration ?? fixture.configuration,
    capability: fixture.capability,
    execute,
    resolveOperation,
    observe,
    now: () => fixture.now,
  });
  return { execute, resolveOperation, observe, run };
}
describe('leased durable custody receipt worker', () => {
  it('maps signed immutable bytes and finishes only after ledger completion acknowledgement', async () => {
    const input = setup();
    expect(await input.run()).toEqual({
      claimed: 1,
      receiptsProcessed: 1,
      deferred: 0,
      blocked: 0,
    });
    expect(input.execute).toHaveBeenLastCalledWith('inboxFinish', [
      fixture.capability,
      fixture.claim.eventId,
      fixture.claim.token,
      'completed',
    ]);
    expect(input.execute.mock.calls.map(([action]) => action)).toEqual([
      'inboxReadiness',
      'inboxClaim',
      'context',
      'settle',
      'inboxFinish',
    ]);
    const settleCall = input.execute.mock.calls.find(
      (call) => call[0] === 'settle'
    ) as unknown as [string, [string]] | undefined;
    expect(JSON.parse(settleCall?.[1]?.[0] ?? '')).toEqual(
      expect.objectContaining({ inboxToken: fixture.claim.token })
    );
  });
  it('completes rotation retries signed with a retained key', async () => {
    const signature = createHmac('sha512', 'retained-custody-key')
      .update(Buffer.from(fixture.claim.rawHex, 'hex'))
      .digest('hex');
    const input = setup({
      configuration: {
        ...fixture.configuration,
        retainedWebhookSecrets: ['retained-custody-key'],
      },
      claims: [{ ...fixture.claim, signature }],
    });
    expect(await input.run()).toEqual({
      claimed: 1,
      receiptsProcessed: 1,
      deferred: 0,
      blocked: 0,
    });
    expect(input.execute).toHaveBeenLastCalledWith('inboxFinish', [
      fixture.capability,
      fixture.claim.eventId,
      fixture.claim.token,
      'completed',
    ]);
  });
  it('retains unmapped signed receipts for retry, not processed or financial completion', async () => {
    const input = setup();
    input.resolveOperation.mockResolvedValue(null);
    expect(await input.run()).toEqual({
      claimed: 1,
      receiptsProcessed: 0,
      deferred: 1,
      blocked: 0,
    });
    expect(input.execute).toHaveBeenLastCalledWith('inboxFinish', [
      fixture.capability,
      fixture.claim.eventId,
      fixture.claim.token,
      'deferred',
    ]);
    expect(input.observe).not.toHaveBeenCalled();
  });
  it('never fetches or settles a receipt whose persisted signature cannot be reverified', async () => {
    const input = setup();
    input.execute
      .mockResolvedValueOnce(fixture.ready)
      .mockResolvedValueOnce([
        { ...fixture.claim, signature: 'a'.repeat(128) },
      ]);
    expect((await input.run()).receiptsProcessed).toBe(0);
    expect(input.resolveOperation).not.toHaveBeenCalled();
    expect(input.observe).not.toHaveBeenCalled();
  });
  it.each([
    'mapping',
    'observations',
    'settlement',
    'invalid-acknowledgement',
  ])('persists %s failure as retryable and fails the worker, never acknowledges deferred success', async (edge) => {
    const input = setup();
    if (edge === 'mapping')
      input.resolveOperation.mockRejectedValue(new Error('outage'));
    if (edge === 'observations')
      input.observe.mockRejectedValue(new Error('outage'));
    if (edge === 'settlement' || edge === 'invalid-acknowledgement')
      input.execute.mockImplementation(async (action: string) => {
        if (action === 'inboxReadiness') return fixture.ready;
        if (action === 'inboxClaim') return [fixture.claim];
        if (action === 'context') return fixture.context;
        if (action === 'settle') {
          if (edge === 'settlement') throw new Error('outage');
          return false;
        }
        return true;
      });
    await expect(input.run()).rejects.toThrow(
      'Signed custody worker unavailable'
    );
    expect(input.execute).toHaveBeenLastCalledWith('inboxFinish', [
      fixture.capability,
      fixture.claim.eventId,
      fixture.claim.token,
      'io_retry',
    ]);
  });
  it('rejects failed finish acknowledgement after settlement; replay can recover by idempotent duplicate settlement', async () => {
    const input = setup();
    input.execute
      .mockResolvedValueOnce(fixture.ready)
      .mockResolvedValueOnce([fixture.claim])
      .mockResolvedValueOnce(fixture.context)
      .mockResolvedValueOnce('completed')
      .mockResolvedValueOnce(false);
    await expect(input.run()).rejects.toThrow();
    expect((await input.run()).receiptsProcessed).toBe(1);
  });
  it('quarantines a conflicting proof without reporting receipt completion', async () => {
    const input = setup();
    input.execute
      .mockResolvedValueOnce(fixture.ready)
      .mockResolvedValueOnce([fixture.claim])
      .mockResolvedValueOnce(fixture.context)
      .mockResolvedValueOnce('conflict');
    expect((await input.run()).blocked).toBe(1);
    expect(input.execute).toHaveBeenLastCalledWith('inboxFinish', [
      fixture.capability,
      fixture.claim.eventId,
      fixture.claim.token,
      'conflict',
    ]);
  });
  it('rejects duplicate claims and unavailable capability before mapping', async () => {
    const input = setup();
    input.execute
      .mockResolvedValueOnce(fixture.ready)
      .mockResolvedValueOnce([fixture.claim, fixture.claim]);
    await expect(input.run()).rejects.toThrow(
      'Signed custody claims unavailable'
    );
    input.execute.mockResolvedValueOnce({ ready: false });
    await expect(input.run()).rejects.toThrow(
      'Signed custody capability unavailable'
    );
    expect(input.resolveOperation).not.toHaveBeenCalled();
  });
});

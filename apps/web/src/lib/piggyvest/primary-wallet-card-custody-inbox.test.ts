import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPrimaryCardCustodyInbox } from './primary-wallet-card-custody-inbox';
import { primaryCardCustodyInboxFixture as fixture } from './primary-wallet-card-custody-inbox.test-fixture';

const execute = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-card-custody-executor', () => ({
  createPrimaryCardCustodyExecutor: () => execute,
}));
beforeEach(() => vi.clearAllMocks());
function setup() {
  const fetchImplementation = vi.fn<typeof fetch>();
  for (const body of [
    fixture.single,
    fixture.single,
    fixture.verification,
    fixture.sourceWallet,
    fixture.destinationWallet,
  ])
    fetchImplementation.mockResolvedValueOnce(
      new Response(JSON.stringify(body))
    );
  return {
    fetchImplementation,
    inbox: createPrimaryCardCustodyInbox({
      configuration: fixture.configuration,
      fetchImplementation,
      resolveAuthenticatedCrosswalk: vi
        .fn()
        .mockResolvedValue(fixture.crosswalk),
      now: () => fixture.now,
    }),
  };
}
describe('concrete intake/storage/mapping/signed ledger wiring', () => {
  it('queues without provider calls and drains via the existing restricted executor and proof boundary', async () => {
    const input = setup();
    execute
      .mockResolvedValueOnce(fixture.ready)
      .mockResolvedValueOnce('accepted');
    expect(
      await input.inbox.acceptSigned(fixture.rawBody, fixture.signature)
    ).toBe('accepted');
    expect(input.fetchImplementation).not.toHaveBeenCalled();
    execute
      .mockResolvedValueOnce(fixture.ready)
      .mockResolvedValueOnce([fixture.claim])
      .mockResolvedValueOnce(fixture.context.operationId)
      .mockResolvedValueOnce(fixture.context)
      .mockResolvedValueOnce('completed')
      .mockResolvedValueOnce(true);
    expect((await input.inbox.drain()).receiptsProcessed).toBe(1);
    expect(input.fetchImplementation).toHaveBeenCalledTimes(5);
    for (const [_url, options] of input.fetchImplementation.mock.calls)
      expect(options?.method).toBe('GET');
    expect(
      execute.mock.calls.find(([action]) => action === 'settle')?.[1]
    ).toEqual([expect.stringContaining('canonical-transfer')]);
  });
  it('exposes explicit database capability readiness without provider actions', async () => {
    const input = setup();
    execute.mockResolvedValue({ ready: false });
    expect(await input.inbox.readiness()).toEqual({ ready: false });
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });
});

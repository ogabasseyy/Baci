import { describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyInboxFixture as fixture } from './primary-wallet-card-custody-inbox.test-fixture';
import { createPrimaryCardCustodyInboxMapping } from './primary-wallet-card-custody-inbox-mapping';

function setup(single: unknown = fixture.single) {
  const fetchImplementation = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify(single)));
  const execute = vi.fn().mockResolvedValue(fixture.context.operationId);
  return {
    execute,
    fetchImplementation,
    resolve: createPrimaryCardCustodyInboxMapping({
      configuration: fixture.configuration,
      capability: fixture.capability,
      execute,
      fetchImplementation,
    }),
  };
}
describe('authenticated exact third-party-reference mapping', () => {
  it('uses the observed documented single-transaction field and stored scope, not a guessed provider ID', async () => {
    const input = setup();
    expect(await input.resolve(fixture.envelope)).toBe(
      fixture.context.operationId
    );
    expect(input.execute).toHaveBeenCalledWith('inboxResolve', [
      fixture.capability,
      fixture.context.reference,
      fixture.context.sourceWalletId,
    ]);
    expect(input.fetchImplementation).toHaveBeenCalledWith(
      expect.stringContaining(
        '/api/v1/transaction/canonical-transfer?wallet_id=owner-treasury'
      ),
      expect.objectContaining({ method: 'GET', redirect: 'error' })
    );
  });
  it.each([
    { third_party_reference: null },
    { third_party_reference: 'goal-legacy' },
    { source_wallet: 'other' },
    { id: 'other' },
    { customer_id: 'other' },
    { status: 'pending' },
  ])('defers unsupported authenticated mapping %# without guessing', async (change) => {
    const input = setup({
      ...fixture.single,
      data: { ...fixture.single.data, ...change },
    });
    expect(await input.resolve(fixture.envelope)).toBeNull();
    expect(input.execute).not.toHaveBeenCalled();
  });
  it('propagates transient provider and mapping storage failures for worker retry', async () => {
    const input = setup();
    input.fetchImplementation.mockRejectedValueOnce(new Error('read outage'));
    await expect(input.resolve(fixture.envelope)).rejects.toThrow();
    input.fetchImplementation.mockResolvedValueOnce(
      new Response(JSON.stringify(fixture.single))
    );
    input.execute.mockRejectedValueOnce(new Error('lookup outage'));
    await expect(input.resolve(fixture.envelope)).rejects.toThrow(
      'lookup outage'
    );
  });
});

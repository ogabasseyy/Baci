import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyFixture as fixture } from './primary-wallet-card-custody.test-fixture';
import { createPrimaryCardCustodyConnection } from './primary-wallet-card-custody-connection';

const execute = vi.hoisted(() => vi.fn());
vi.mock('./primary-wallet-card-custody-executor', () => ({
  createPrimaryCardCustodyExecutor: () => execute,
}));
beforeEach(() => vi.clearAllMocks());
function setup() {
  const fetchImplementation = vi.fn<typeof fetch>();
  for (const body of [
    fixture.single,
    fixture.verification,
    fixture.sourceWallet,
    fixture.destinationWallet,
  ])
    fetchImplementation.mockResolvedValueOnce(
      new Response(JSON.stringify(body))
    );
  const submitApprovedTransfer = vi.fn().mockResolvedValue(undefined);
  const lookupApprovedTransfer = vi.fn().mockResolvedValue('absent');
  const connection = createPrimaryCardCustodyConnection({
    configuration: fixture.configuration,
    fetchImplementation,
    submitApprovedTransfer,
    lookupApprovedTransfer,
    resolveAuthenticatedCrosswalk: vi.fn().mockResolvedValue(fixture.crosswalk),
    now: () => fixture.now,
  });
  return {
    connection,
    fetchImplementation,
    submitApprovedTransfer,
    lookupApprovedTransfer,
  };
}
describe('concrete storage to signed settlement connection', () => {
  it('never submits a claimed destination different from the durable scoped context', async () => {
    const input = setup();
    execute
      .mockResolvedValueOnce(fixture.context)
      .mockResolvedValueOnce({
        outcome: 'claimed',
        token: fixture.context.customerId,
        command: {
          operationId: fixture.context.operationId,
          sourceWalletId: fixture.context.sourceWalletId,
          destinationWalletId: 'wrong-destination',
          amountKobo: fixture.context.amountKobo,
          reference: fixture.context.reference,
          currency: 'NGN',
        },
      })
      .mockResolvedValueOnce(true);
    expect(await input.connection.dispatch(fixture.context.operationId)).toBe(
      'unknown'
    );
    expect(input.submitApprovedTransfer).not.toHaveBeenCalled();
  });
  it('routes signed observations to scoped durable context and settlement SQL adapter', async () => {
    const input = setup();
    execute
      .mockResolvedValueOnce(fixture.context)
      .mockResolvedValueOnce('completed');
    const rawBody = new TextEncoder().encode(JSON.stringify(fixture.envelope));
    const signature = createHmac('sha512', fixture.configuration.webhookSecret)
      .update(rawBody)
      .digest('hex');
    expect(
      await input.connection.applySignedCustody({
        operationId: fixture.context.operationId,
        rawBody,
        signature,
      })
    ).toBe('completed');
    expect(execute.mock.calls[0]).toEqual([
      'context',
      [fixture.context.operationId],
    ]);
    expect(execute.mock.calls[1][0]).toBe('settle');
    expect(JSON.parse(execute.mock.calls[1][1][0])).toEqual(
      expect.objectContaining({
        amountKobo: 25000,
        transactionAliases: ['bank-transfer', 'canonical-transfer'],
      })
    );
    expect(input.submitApprovedTransfer).not.toHaveBeenCalled();
  });
  it('has no financial dispatch for existing durable claims', async () => {
    const input = setup();
    execute
      .mockResolvedValueOnce(fixture.context)
      .mockResolvedValueOnce({ outcome: 'existing' });
    expect(await input.connection.dispatch(fixture.context.operationId)).toBe(
      'existing'
    );
    expect(input.submitApprovedTransfer).not.toHaveBeenCalled();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });
  it('rejects dispatch when durable business ownership differs from trusted runtime', async () => {
    const input = setup();
    execute.mockResolvedValueOnce({
      ...fixture.context,
      businessId: 'other-business',
    });
    await expect(
      input.connection.dispatch(fixture.context.operationId)
    ).rejects.toThrow('Custody deployment unavailable');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(input.submitApprovedTransfer).not.toHaveBeenCalled();
  });
  it('rejects unsigned custody before any database or provider observation', async () => {
    const input = setup();
    await expect(
      input.connection.applySignedCustody({
        operationId: fixture.context.operationId,
        rawBody: new Uint8Array([1]),
        signature: null,
      })
    ).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
    expect(input.fetchImplementation).not.toHaveBeenCalled();
  });
});

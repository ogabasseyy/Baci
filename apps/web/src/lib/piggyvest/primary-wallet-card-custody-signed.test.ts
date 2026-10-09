import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyFixture as fixture } from './primary-wallet-card-custody.test-fixture';
import { applyPrimaryCardSignedCustody } from './primary-wallet-card-custody-signed';

function setup() {
  const rawBody = new TextEncoder().encode(JSON.stringify(fixture.envelope));
  return {
    rawBody,
    signature: createHmac('sha512', fixture.configuration.webhookSecret)
      .update(rawBody)
      .digest('hex'),
    secret: fixture.configuration.webhookSecret,
    operationId: fixture.context.operationId,
    inboxToken: fixture.context.customerId,
    loadContext: vi.fn().mockResolvedValue(fixture.context),
    observe: vi.fn().mockResolvedValue(fixture),
    settle: vi.fn().mockResolvedValue('completed'),
    now: () => fixture.now,
  };
}
describe('signed primary custody boundary', () => {
  it.each([
    'completed',
    'duplicate',
    'conflict',
  ])('returns durable %s only after signature and independent proof', async (outcome) => {
    const input = setup();
    input.settle.mockResolvedValue(outcome);
    expect(await applyPrimaryCardSignedCustody(input)).toBe(outcome);
    expect(input.settle).toHaveBeenCalledWith(
      expect.objectContaining({
        amountKobo: 25000,
        providerTransactionId: 'canonical-transfer',
        transactionAliases: ['bank-transfer', 'canonical-transfer'],
        inboxToken: fixture.context.customerId,
      })
    );
  });
  it('verifies rotation retries against retained secrets', async () => {
    const input = setup();
    const signature = createHmac('sha512', 'retained-custody-key')
      .update(input.rawBody)
      .digest('hex');
    expect(
      await applyPrimaryCardSignedCustody({
        ...input,
        signature,
        retainedSecrets: ['retained-custody-key'],
      })
    ).toBe('completed');
  });
  it.each([
    { signature: null },
    { secret: undefined },
    { signature: 'a'.repeat(128) },
    { rawBody: new TextEncoder().encode('tampered') },
    { rawBody: new Uint8Array(65537) },
  ])('rejects unsigned or altered bytes before reads %#', async (change) => {
    const input = { ...setup(), ...change };
    await expect(applyPrimaryCardSignedCustody(input)).rejects.toThrow(
      'Custody authentication failed'
    );
    expect(input.loadContext).not.toHaveBeenCalled();
    expect(input.observe).not.toHaveBeenCalled();
    expect(input.settle).not.toHaveBeenCalled();
  });
  it('never accepts signed success alone without exhaustive authenticated crosswalk', async () => {
    const input = setup();
    input.observe.mockResolvedValue({ ...fixture, crosswalk: null });
    expect(await applyPrimaryCardSignedCustody(input)).toBe('deferred');
    expect(input.settle).not.toHaveBeenCalled();
  });
  it.each([
    'loadContext',
    'observe',
    'settle',
  ] as const)('propagates %s I/O failure for retry rather than acknowledging deferred', async (edge) => {
    const input = setup();
    const failure = new Error('mock transient failure');
    input[edge].mockRejectedValue(failure);
    await expect(applyPrimaryCardSignedCustody(input)).rejects.toBe(failure);
  });
  it('rejects invalid settlement acknowledgement instead of acknowledging deferred', async () => {
    const input = setup();
    input.settle.mockResolvedValue('custody_pending');
    await expect(applyPrimaryCardSignedCustody(input)).rejects.toThrow();
  });
  it('rejects malformed storage context acknowledgement instead of acknowledging deferred', async () => {
    const input = setup();
    input.loadContext.mockResolvedValue(null);
    await expect(applyPrimaryCardSignedCustody(input)).rejects.toThrow();
    expect(input.settle).not.toHaveBeenCalled();
  });
  it('defers malformed signed evidence without attempting settlement', async () => {
    const input = setup();
    input.rawBody = new TextEncoder().encode('{');
    input.signature = createHmac('sha512', input.secret)
      .update(input.rawBody)
      .digest('hex');
    expect(await applyPrimaryCardSignedCustody(input)).toBe('deferred');
    expect(input.loadContext).not.toHaveBeenCalled();
    expect(input.settle).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { primaryCardCustodyFixture as fixture } from './primary-wallet-card-custody.test-fixture';
import { runPrimaryCardTransfer } from './primary-wallet-card-transfer-worker';

function setup() {
  return {
    operationId: fixture.context.operationId,
    claim: vi.fn().mockResolvedValue({
      outcome: 'claimed',
      token: fixture.context.customerId,
      command: {
        operationId: fixture.context.operationId,
        sourceWalletId: fixture.context.sourceWalletId,
        destinationWalletId: fixture.context.destinationWalletId,
        amountKobo: 25000,
        currency: 'NGN',
        reference: fixture.context.reference,
      },
    }),
    submitTransfer: vi.fn().mockResolvedValue(undefined),
    lookupTransfer: vi.fn().mockResolvedValue('not_found'),
    record: vi.fn().mockResolvedValue(true),
  };
}
describe('irreversible primary transfer dispatch', () => {
  it('submits only the immutable owner selected treasury command', async () => {
    const input = setup();
    expect(await runPrimaryCardTransfer(input)).toBe('submitted');
    expect(input.record).toHaveBeenCalledWith(
      input.operationId,
      fixture.context.customerId,
      true
    );
    input.claim.mockResolvedValue({ outcome: 'existing' });
    expect(await runPrimaryCardTransfer(input)).toBe('existing');
    expect(input.submitTransfer).toHaveBeenCalledTimes(1);
  });
  it('keeps ambiguous financial outcome unknown without retry or releasing capacity', async () => {
    const input = setup();
    input.submitTransfer.mockRejectedValue(
      new Error('connection lost after send')
    );
    input.lookupTransfer.mockResolvedValue('uncertain');
    expect(await runPrimaryCardTransfer(input)).toBe('unknown');
    expect(input.record).toHaveBeenCalledWith(
      input.operationId,
      fixture.context.customerId,
      false
    );
    input.claim.mockResolvedValue({ outcome: 'existing' });
    expect(await runPrimaryCardTransfer(input)).toBe('existing');
    expect(input.submitTransfer).toHaveBeenCalledTimes(1);
  });
  it.each([
    'not_found',
    'pending',
    'failed',
  ] as const)('holds a submit throw observed as %s unknown for review, never resubmitting the reference', async (observed) => {
    // docs/piggyvest-contract-evidence/2026-10-31.md, P2: a 202-accepted
    // transfer answers TSQ 404 before it is indexed, so a 404 after a lost
    // response is never proof of absence.
    const input = setup();
    input.submitTransfer.mockRejectedValue(new Error('timeout before commit'));
    input.lookupTransfer.mockResolvedValue(observed);
    expect(await runPrimaryCardTransfer(input)).toBe('unknown');
    expect(input.record).toHaveBeenCalledWith(
      input.operationId,
      fixture.context.customerId,
      false
    );
    expect(input.submitTransfer).toHaveBeenCalledTimes(1);
  });
  it('records submitted without resubmitting when the reference exists despite the submit throw', async () => {
    const input = setup();
    input.submitTransfer.mockRejectedValue(new Error('response lost'));
    input.lookupTransfer.mockResolvedValue('submitted');
    expect(await runPrimaryCardTransfer(input)).toBe('submitted');
    expect(input.record).toHaveBeenCalledWith(
      input.operationId,
      fixture.context.customerId,
      true
    );
    expect(input.submitTransfer).toHaveBeenCalledTimes(1);
  });
  it('records unknown when the post-failure lookup itself crashes', async () => {
    const input = setup();
    input.submitTransfer.mockRejectedValue(new Error('timeout before commit'));
    input.lookupTransfer.mockRejectedValue(new Error('private lookup bug'));
    expect(await runPrimaryCardTransfer(input)).toBe('unknown');
    expect(input.record).toHaveBeenCalledWith(
      input.operationId,
      fixture.context.customerId,
      false
    );
  });
  it('does not call a financial adapter for an invalid claim', async () => {
    const input = setup();
    input.claim.mockResolvedValue({
      outcome: 'claimed',
      token: fixture.context.customerId,
      command: {},
    });
    await expect(runPrimaryCardTransfer(input)).rejects.toThrow();
    expect(input.submitTransfer).not.toHaveBeenCalled();
  });
  it('does not acknowledge completion after a lost storage acknowledgement', async () => {
    const input = setup();
    input.record.mockResolvedValue(false);
    await expect(runPrimaryCardTransfer(input)).rejects.toThrow(
      'Transfer result unavailable'
    );
    expect(input.submitTransfer).toHaveBeenCalledTimes(1);
  });
  it('never looks up a fresh claim before submitting', async () => {
    const input = setup();
    expect(await runPrimaryCardTransfer(input)).toBe('submitted');
    expect(input.lookupTransfer).not.toHaveBeenCalled();
  });
  it('records a reclaimed claim as submitted without resubmitting when the provider holds the reference', async () => {
    const input = setup();
    input.claim.mockResolvedValue({
      outcome: 'reclaimed',
      token: fixture.context.customerId,
      command: {
        operationId: fixture.context.operationId,
        sourceWalletId: fixture.context.sourceWalletId,
        destinationWalletId: fixture.context.destinationWalletId,
        amountKobo: 25000,
        currency: 'NGN',
        reference: fixture.context.reference,
      },
    });
    input.lookupTransfer.mockResolvedValue('submitted');
    expect(await runPrimaryCardTransfer(input)).toBe('submitted');
    expect(input.submitTransfer).not.toHaveBeenCalled();
    expect(input.record).toHaveBeenCalledWith(
      input.operationId,
      fixture.context.customerId,
      true
    );
  });
  it.each([
    'not_found',
    'pending',
    'failed',
    'uncertain',
    'lookup-crash',
  ] as const)('records unknown without resubmitting when the reclaimed lookup is %s', async (mode) => {
    const input = setup();
    input.claim.mockResolvedValue({
      outcome: 'reclaimed',
      token: fixture.context.customerId,
      command: {
        operationId: fixture.context.operationId,
        sourceWalletId: fixture.context.sourceWalletId,
        destinationWalletId: fixture.context.destinationWalletId,
        amountKobo: 25000,
        currency: 'NGN',
        reference: fixture.context.reference,
      },
    });
    if (mode === 'lookup-crash')
      input.lookupTransfer.mockRejectedValue(new Error('private lookup bug'));
    else input.lookupTransfer.mockResolvedValue(mode);
    expect(await runPrimaryCardTransfer(input)).toBe('unknown');
    expect(input.submitTransfer).not.toHaveBeenCalled();
    expect(input.record).toHaveBeenCalledWith(
      input.operationId,
      fixture.context.customerId,
      false
    );
  });
});

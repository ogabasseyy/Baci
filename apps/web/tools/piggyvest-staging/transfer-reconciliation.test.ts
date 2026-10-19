import { describe, expect, it, vi } from 'vitest';
import {
  type ExpectedOutflowOperation,
  reconcileVerifiedOutflowTerminal,
} from './transfer-reconciliation';

const submittedOperation: ExpectedOutflowOperation = {
  reference: 'synthetic-outflow-001',
  amountKobo: 500_000,
  currency: 'NGN',
  sourceWalletId: 'source-wallet-001',
  destinationWalletId: 'destination-wallet-001',
  direction: 'bank',
  providerCustomerId: 'provider-customer-001',
  businessId: 'business-001',
  integrationId: 'integration-001',
  status: 'submitted',
};

const matchingEvidence = {
  reference: 'synthetic-outflow-001',
  amountKobo: 500_000,
  currency: 'NGN',
  sourceWalletId: 'source-wallet-001',
  destinationWalletId: 'destination-wallet-001',
  direction: 'bank' as const,
  providerCustomerId: 'provider-customer-001',
  businessId: 'business-001',
  integrationId: 'integration-001',
  providerTransactionId: 'provider-transaction-001',
};

describe('reconcileVerifiedOutflowTerminal', () => {
  it('passes fully matched scope and evidence into the atomic compare-and-set', async () => {
    const compareAndSetTerminal = vi.fn(async () => 'applied' as const);

    const result = await reconcileVerifiedOutflowTerminal(
      {
        expected: submittedOperation,
        evidence: matchingEvidence,
        terminalStatus: 'succeeded',
      },
      { compareAndSetTerminal }
    );

    expect(result).toEqual({ outcome: 'applied', status: 'succeeded' });
    expect(compareAndSetTerminal).toHaveBeenCalledWith({
      expected: submittedOperation,
      evidence: matchingEvidence,
      terminalStatus: 'succeeded',
    });
  });

  it('does not update a terminal event whose destination differs', async () => {
    const compareAndSetTerminal = vi.fn(async () => 'applied' as const);

    const result = await reconcileVerifiedOutflowTerminal(
      {
        expected: submittedOperation,
        evidence: {
          ...matchingEvidence,
          destinationWalletId: 'different-wallet',
        },
        terminalStatus: 'succeeded',
      },
      { compareAndSetTerminal }
    );

    expect(result).toEqual({
      outcome: 'unresolved',
      reason: 'destination-mismatch',
    });
    expect(compareAndSetTerminal).not.toHaveBeenCalled();
  });

  it('does not update a terminal event from another provider business', async () => {
    const compareAndSetTerminal = vi.fn(async () => 'applied' as const);

    const result = await reconcileVerifiedOutflowTerminal(
      {
        expected: submittedOperation,
        evidence: { ...matchingEvidence, businessId: 'business-foreign' },
        terminalStatus: 'succeeded',
      },
      { compareAndSetTerminal }
    );

    expect(result).toEqual({
      outcome: 'unresolved',
      reason: 'business-mismatch',
    });
    expect(compareAndSetTerminal).not.toHaveBeenCalled();
  });

  it.each([
    [
      'reference',
      { reference: 'synthetic-outflow-foreign' },
      'reference-mismatch',
    ],
    ['amount', { amountKobo: 500_001 }, 'amount-mismatch'],
    ['source', { sourceWalletId: 'source-wallet-foreign' }, 'source-mismatch'],
    [
      'provider customer',
      { providerCustomerId: 'provider-customer-foreign' },
      'provider-customer-mismatch',
    ],
    [
      'integration',
      { integrationId: 'integration-foreign' },
      'integration-mismatch',
    ],
  ] as const)('does not update a terminal event with a mismatched %s identity', async (_identity, evidenceOverride, reason) => {
    const compareAndSetTerminal = vi.fn(async () => 'applied' as const);

    const result = await reconcileVerifiedOutflowTerminal(
      {
        expected: submittedOperation,
        evidence: { ...matchingEvidence, ...evidenceOverride },
        terminalStatus: 'succeeded',
      },
      { compareAndSetTerminal }
    );

    expect(result).toEqual({ outcome: 'unresolved', reason });
    expect(compareAndSetTerminal).not.toHaveBeenCalled();
  });

  it('asks durable storage whether an already terminal snapshot is a duplicate', async () => {
    const compareAndSetTerminal = vi.fn(async () => 'duplicate' as const);

    const result = await reconcileVerifiedOutflowTerminal(
      {
        expected: { ...submittedOperation, status: 'succeeded' },
        evidence: matchingEvidence,
        terminalStatus: 'succeeded',
      },
      { compareAndSetTerminal }
    );

    expect(result).toEqual({ outcome: 'duplicate', status: 'succeeded' });
    expect(compareAndSetTerminal).toHaveBeenCalledOnce();
  });

  it('asks durable storage whether an opposite terminal snapshot conflicts', async () => {
    const compareAndSetTerminal = vi.fn(
      async () => 'terminal-conflict' as const
    );

    const result = await reconcileVerifiedOutflowTerminal(
      {
        expected: { ...submittedOperation, status: 'succeeded' },
        evidence: matchingEvidence,
        terminalStatus: 'failed',
      },
      { compareAndSetTerminal }
    );

    expect(result).toEqual({ outcome: 'terminal-conflict' });
    expect(compareAndSetTerminal).toHaveBeenCalledOnce();
  });

  it('does not let a stale terminal snapshot prevent a durable apply', async () => {
    const compareAndSetTerminal = vi.fn(async () => 'applied' as const);

    const result = await reconcileVerifiedOutflowTerminal(
      {
        expected: { ...submittedOperation, status: 'failed' },
        evidence: matchingEvidence,
        terminalStatus: 'succeeded',
      },
      { compareAndSetTerminal }
    );

    expect(result).toEqual({ outcome: 'applied', status: 'succeeded' });
    expect(compareAndSetTerminal).toHaveBeenCalledOnce();
  });

  it('reports a concurrent conflicting compare-and-set without crediting', async () => {
    const compareAndSetTerminal = vi.fn(
      async () => 'terminal-conflict' as const
    );

    const result = await reconcileVerifiedOutflowTerminal(
      {
        expected: submittedOperation,
        evidence: matchingEvidence,
        terminalStatus: 'succeeded',
      },
      { compareAndSetTerminal }
    );

    expect(result).toEqual({ outcome: 'terminal-conflict' });
  });

  it('reports a concurrent compare-and-set refusal without crediting', async () => {
    const compareAndSetTerminal = vi.fn(async () => 'not-submitted' as const);

    const result = await reconcileVerifiedOutflowTerminal(
      {
        expected: submittedOperation,
        evidence: matchingEvidence,
        terminalStatus: 'succeeded',
      },
      { compareAndSetTerminal }
    );

    expect(result).toEqual({
      outcome: 'unresolved',
      reason: 'outbox-not-submitted',
    });
  });
});

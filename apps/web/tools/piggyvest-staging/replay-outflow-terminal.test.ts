import { describe, expect, it, vi } from 'vitest';
import { dispatchReplayOutflowTerminal } from './replay-outflow-terminal';
import type { ExpectedOutflowOperation } from './transfer-reconciliation';

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

describe('dispatchReplayOutflowTerminal', () => {
  it('leaves a documented terminal webhook unresolved until a provider-certified identity normalizer is supplied', async () => {
    const findExpected = vi.fn(async () => submittedOperation);
    const compareAndSetTerminal = vi.fn(async () => 'applied' as const);

    const result = await dispatchReplayOutflowTerminal(
      {
        eventId: 'event-synthetic-001',
        eventType: 'bank-transfer.outflow.success',
        eventCategory: 'outflow_transaction',
        customer_id: 'provider-customer-001',
        eventData: { reference: 'synthetic-outflow-001' },
      },
      {
        findExpected,
        compareAndSetTerminal,
        normalizeEvidence: () => null,
      }
    );

    expect(result).toEqual({
      outcome: 'unresolved',
      reason: 'missing-provider-terminal-identity',
    });
    expect(findExpected).not.toHaveBeenCalled();
    expect(compareAndSetTerminal).not.toHaveBeenCalled();
  });

  it('rejects malformed normalizer output before lookup or mutation', async () => {
    const findExpected = vi.fn(async () => submittedOperation);
    const compareAndSetTerminal = vi.fn(async () => 'applied' as const);

    const result = await dispatchReplayOutflowTerminal(
      {
        eventId: 'event-synthetic-002',
        eventType: 'bank-transfer.outflow.success',
        eventCategory: 'outflow_transaction',
        customer_id: 'provider-customer-001',
        eventData: {},
      },
      {
        findExpected,
        compareAndSetTerminal,
        normalizeEvidence: () => ({ reference: 'synthetic-outflow-001' }),
      }
    );

    expect(result).toEqual({
      outcome: 'unresolved',
      reason: 'malformed-provider-terminal-identity',
    });
    expect(findExpected).not.toHaveBeenCalled();
    expect(compareAndSetTerminal).not.toHaveBeenCalled();
  });

  it('rejects a terminal event whose customer does not match the operation', async () => {
    const findExpected = vi.fn(async () => submittedOperation);
    const compareAndSetTerminal = vi.fn(async () => 'applied' as const);

    const result = await dispatchReplayOutflowTerminal(
      {
        eventId: 'event-synthetic-003',
        eventType: 'bank-transfer.outflow.success',
        eventCategory: 'outflow_transaction',
        customer_id: 'provider-customer-foreign',
        eventData: {},
      },
      {
        findExpected,
        compareAndSetTerminal,
        normalizeEvidence: () => matchingEvidence,
      }
    );

    expect(result).toEqual({
      outcome: 'unresolved',
      reason: 'event-provider-customer-mismatch',
    });
    expect(compareAndSetTerminal).not.toHaveBeenCalled();
  });

  it('rejects evidence whose direction conflicts with the terminal event type', async () => {
    const findExpected = vi.fn(async () => submittedOperation);
    const compareAndSetTerminal = vi.fn(async () => 'applied' as const);

    const result = await dispatchReplayOutflowTerminal(
      {
        eventId: 'event-synthetic-004',
        eventType: 'bank-transfer.outflow.success',
        eventCategory: 'outflow_transaction',
        customer_id: 'provider-customer-001',
        eventData: {},
      },
      {
        findExpected,
        compareAndSetTerminal,
        normalizeEvidence: () => ({ ...matchingEvidence, direction: 'wallet' }),
      }
    );

    expect(result).toEqual({
      outcome: 'unresolved',
      reason: 'event-direction-mismatch',
    });
    expect(compareAndSetTerminal).not.toHaveBeenCalled();
  });

  it('applies only a fully matched provider-normalized terminal event', async () => {
    const findExpected = vi.fn(async () => submittedOperation);
    const compareAndSetTerminal = vi.fn(async () => 'applied' as const);

    const result = await dispatchReplayOutflowTerminal(
      {
        eventId: 'event-synthetic-005',
        eventType: 'bank-transfer.outflow.failed',
        eventCategory: 'outflow_transaction',
        customer_id: 'provider-customer-001',
        eventData: {},
      },
      {
        findExpected,
        compareAndSetTerminal,
        normalizeEvidence: () => matchingEvidence,
      }
    );

    expect(result).toEqual({ outcome: 'applied', status: 'failed' });
    expect(findExpected).toHaveBeenCalledWith('synthetic-outflow-001');
    expect(compareAndSetTerminal).toHaveBeenCalledWith({
      expected: submittedOperation,
      evidence: matchingEvidence,
      terminalStatus: 'failed',
    });
  });
});

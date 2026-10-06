import {
  type ExpectedOutflowOperation,
  type TerminalEvidence,
  type TerminalStatus,
  terminalReconciliationInputSchema,
} from './schemas/transfer-reconciliation';

export type { ExpectedOutflowOperation, TerminalEvidence };

type TerminalReconciliationReason =
  | 'malformed-terminal-identity'
  | 'reference-mismatch'
  | 'amount-mismatch'
  | 'currency-mismatch'
  | 'source-mismatch'
  | 'destination-mismatch'
  | 'direction-mismatch'
  | 'provider-customer-mismatch'
  | 'business-mismatch'
  | 'integration-mismatch'
  | 'outbox-not-submitted'
  | 'tsq-missing-identity';

export type TerminalReconciliationOutcome =
  | { outcome: 'applied'; status: TerminalStatus }
  | { outcome: 'duplicate'; status: TerminalStatus }
  | { outcome: 'pending' }
  | { outcome: 'unknown' }
  | { outcome: 'terminal-conflict' }
  | { outcome: 'unresolved'; reason: TerminalReconciliationReason };

export interface AtomicTerminalWriter {
  compareAndSetTerminal: (input: {
    expected: ExpectedOutflowOperation;
    evidence: TerminalEvidence;
    terminalStatus: TerminalStatus;
  }) => Promise<
    'applied' | 'duplicate' | 'terminal-conflict' | 'not-submitted'
  >;
}

function mismatchReason(
  expected: ExpectedOutflowOperation,
  evidence: TerminalEvidence
): TerminalReconciliationReason | null {
  if (evidence.reference !== expected.reference) return 'reference-mismatch';
  if (evidence.amountKobo !== expected.amountKobo) return 'amount-mismatch';
  if (evidence.currency !== expected.currency) return 'currency-mismatch';
  if (evidence.sourceWalletId !== expected.sourceWalletId) {
    return 'source-mismatch';
  }
  if (evidence.destinationWalletId !== expected.destinationWalletId) {
    return 'destination-mismatch';
  }
  if (evidence.direction !== expected.direction) return 'direction-mismatch';
  if (evidence.providerCustomerId !== expected.providerCustomerId) {
    return 'provider-customer-mismatch';
  }
  if (evidence.businessId !== expected.businessId) return 'business-mismatch';
  if (evidence.integrationId !== expected.integrationId) {
    return 'integration-mismatch';
  }
  return null;
}

export async function reconcileVerifiedOutflowTerminal(
  input: unknown,
  writer: AtomicTerminalWriter
): Promise<TerminalReconciliationOutcome> {
  const parsed = terminalReconciliationInputSchema.safeParse(input);
  if (!parsed.success) {
    return { outcome: 'unresolved', reason: 'malformed-terminal-identity' };
  }
  const { expected, evidence, terminalStatus } = parsed.data;
  const mismatch = mismatchReason(expected, evidence);
  if (mismatch) return { outcome: 'unresolved', reason: mismatch };

  const outcome = await writer.compareAndSetTerminal({
    expected,
    evidence,
    terminalStatus,
  });
  if (outcome === 'applied')
    return { outcome: 'applied', status: terminalStatus };
  if (outcome === 'duplicate')
    return { outcome: 'duplicate', status: terminalStatus };
  if (outcome === 'terminal-conflict') return { outcome: 'terminal-conflict' };
  return { outcome: 'unresolved', reason: 'outbox-not-submitted' };
}

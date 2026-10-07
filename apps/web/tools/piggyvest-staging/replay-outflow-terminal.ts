import {
  type ReplayOutflowTerminalEvent,
  replayOutflowTerminalEventSchema,
  terminalEvidenceSchema,
} from './schemas/transfer-reconciliation';
import {
  type AtomicTerminalWriter,
  type ExpectedOutflowOperation,
  reconcileVerifiedOutflowTerminal,
  type TerminalReconciliationOutcome,
} from './transfer-reconciliation';

export interface ReplayOutflowTerminalDependencies
  extends AtomicTerminalWriter {
  findExpected: (reference: string) => Promise<ExpectedOutflowOperation | null>;
  normalizeEvidence: (event: ReplayOutflowTerminalEvent) => unknown;
}

export type ReplayOutflowTerminalOutcome =
  | TerminalReconciliationOutcome
  | {
      outcome: 'unresolved';
      reason:
        | 'missing-provider-terminal-identity'
        | 'malformed-provider-terminal-identity'
        | 'unknown-submitted-operation'
        | 'event-provider-customer-mismatch'
        | 'event-direction-mismatch'
        | 'unsupported-event';
    };

function terminalDirection(
  event: ReplayOutflowTerminalEvent
): 'bank' | 'wallet' {
  return event.eventType === 'wallet-transfer.outflow.success'
    ? 'wallet'
    : 'bank';
}

function terminalStatus(
  event: ReplayOutflowTerminalEvent
): 'succeeded' | 'failed' {
  return event.eventType === 'bank-transfer.outflow.failed'
    ? 'failed'
    : 'succeeded';
}

export async function dispatchReplayOutflowTerminal(
  payload: unknown,
  dependencies: ReplayOutflowTerminalDependencies
): Promise<ReplayOutflowTerminalOutcome> {
  const event = replayOutflowTerminalEventSchema.safeParse(payload);
  if (!event.success)
    return { outcome: 'unresolved', reason: 'unsupported-event' };

  let normalized: unknown;
  try {
    normalized = dependencies.normalizeEvidence(event.data);
  } catch {
    return {
      outcome: 'unresolved',
      reason: 'malformed-provider-terminal-identity',
    };
  }
  if (normalized === null) {
    return {
      outcome: 'unresolved',
      reason: 'missing-provider-terminal-identity',
    };
  }

  const evidence = terminalEvidenceSchema.safeParse(normalized);
  if (!evidence.success) {
    return {
      outcome: 'unresolved',
      reason: 'malformed-provider-terminal-identity',
    };
  }
  if (evidence.data.providerCustomerId !== event.data.customer_id) {
    return {
      outcome: 'unresolved',
      reason: 'event-provider-customer-mismatch',
    };
  }
  if (evidence.data.direction !== terminalDirection(event.data)) {
    return { outcome: 'unresolved', reason: 'event-direction-mismatch' };
  }

  const expected = await dependencies.findExpected(evidence.data.reference);
  if (!expected) {
    return { outcome: 'unresolved', reason: 'unknown-submitted-operation' };
  }
  return reconcileVerifiedOutflowTerminal(
    {
      expected,
      evidence: evidence.data,
      terminalStatus: terminalStatus(event.data),
    },
    dependencies
  );
}

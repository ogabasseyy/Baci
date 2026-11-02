import type { PiggyvestWebhookEvent } from '@/schemas/piggyvest/events';
import { InflowLedgerError } from './inflow-ledger';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

const MAX_REMEMBERED_EVENTS = 500;
const alerted = new Set<string>();

/**
 * An unmapped deposit stays retryable, so PiggyVest redelivers it. Page an
 * operator once per key (per server instance) instead of on every attempt.
 * The key is remembered only after the alert went out, so a failed alert is
 * tried again on the next delivery. Memory is bounded; the oldest are dropped.
 */
export function alertOncePerEvent(key: string, emit: () => void): void {
  if (alerted.has(key)) return;
  emit();
  alerted.add(key);
  if (alerted.size > MAX_REMEMBERED_EVENTS) {
    const oldest = alerted.values().next().value;
    if (oldest !== undefined) alerted.delete(oldest);
  }
}

export function resetUnmappedAlertMemoryForTests(): void {
  alerted.clear();
}

/**
 * Page an operator once per deposit (provider transaction, since a redelivery
 * may carry a new event id) while the delivery stays retryable: the mapping
 * may still be committing. Best effort; it never changes the retry outcome.
 */
export function alertUnmappedInflow(
  error: unknown,
  event: PiggyvestWebhookEvent
): void {
  if (
    !(error instanceof InflowLedgerError) ||
    error.code !== 'INFLOW_LEDGER_UNMAPPED'
  ) {
    return;
  }
  try {
    const alertKey =
      event.eventType === 'bank-transfer.inflow.success'
        ? `txn:${event.eventData.transaction_id}`
        : `event:${event.eventId}`;
    alertOncePerEvent(alertKey, () =>
      emitPiggyvestWebhookAlert('PIGGYVEST_INFLOW_UNMAPPED', {
        eventType: event.eventType,
        operationId: event.eventId,
      })
    );
  } catch {
    // Alerting must not affect the money path.
  }
}

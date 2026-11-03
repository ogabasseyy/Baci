import type { PiggyvestWebhookEvent } from '@/schemas/piggyvest/events';
import { InflowLedgerError } from './inflow-ledger';
import { emitPiggyvestWebhookAlertDelivered } from './webhook-alerts';

const MAX_REMEMBERED_EVENTS = 500;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const alerted = new Set<string>();
const inFlight = new Set<string>();

/**
 * An unmapped deposit stays retryable, so PiggyVest redelivers it. Page an
 * operator once per key (per server instance) instead of on every attempt.
 * The key is remembered only after the page was delivered, so a failed,
 * timed-out or throwing alert is tried again on the next delivery. Keys
 * being sent right now are skipped, so concurrent redeliveries do not
 * double-page. Memory is bounded; the oldest are dropped.
 */
export async function alertOncePerEvent(
  key: string,
  emit: () => Promise<boolean>
): Promise<void> {
  if (alerted.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  try {
    if (!(await emit())) return;
    alerted.add(key);
    if (alerted.size > MAX_REMEMBERED_EVENTS) {
      const oldest = alerted.values().next().value;
      if (oldest !== undefined) alerted.delete(oldest);
    }
  } finally {
    inFlight.delete(key);
  }
}

export function resetUnmappedAlertMemoryForTests(): void {
  alerted.clear();
  inFlight.clear();
}

/**
 * Page an operator once per deposit (provider transaction, since a redelivery
 * may carry a new event id) while the delivery stays retryable: the mapping
 * may still be committing. Best effort and per server instance; it never
 * rejects and never changes the retry outcome.
 */
export async function alertUnmappedInflow(
  error: unknown,
  event: PiggyvestWebhookEvent
): Promise<void> {
  if (
    !(error instanceof InflowLedgerError) ||
    error.code !== 'INFLOW_LEDGER_UNMAPPED'
  ) {
    return;
  }
  try {
    const txn =
      event.eventType === 'bank-transfer.inflow.success'
        ? String(event.eventData.transaction_id)
        : null;
    const alertKey = txn ? `txn:${txn}` : `event:${event.eventId}`;
    // The PostHog identity follows the deposit, so a redelivery with a new
    // event id does not create a second PostHog event.
    const operationId = txn && SAFE_IDENTIFIER.test(txn) ? txn : event.eventId;
    await alertOncePerEvent(alertKey, () =>
      emitPiggyvestWebhookAlertDelivered('PIGGYVEST_INFLOW_UNMAPPED', {
        eventType: event.eventType,
        operationId,
      })
    );
  } catch {
    // Alerting must not affect the money path.
  }
}

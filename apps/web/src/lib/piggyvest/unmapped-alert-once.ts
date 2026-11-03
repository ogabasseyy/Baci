import { createHash } from 'node:crypto';
import type { PiggyvestWebhookEvent } from '@/schemas/piggyvest/events';
import { InflowLedgerError } from './inflow-ledger';
import {
  logPiggyvestWebhookAlert,
  sendPiggyvestWebhookAlertDelivered,
} from './webhook-alerts';

const MAX_REMEMBERED_EVENTS = 500;
const SAFE_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const alerted = new Set<string>();
const posthogPending = new Set<string>();
const inFlight = new Set<string>();

/**
 * The log page fires once per deposit per server instance; PostHog is
 * deduplicated across instances. An unmapped deposit stays retryable, so PiggyVest redelivers it. The
 * primary page is the console line: it is written once per key (per server
 * instance) and remembered as soon as it is written, whatever PostHog does,
 * so a PostHog outage cannot repeat the log line on every redelivery.
 * PostHog is best effort: a failed send is retried on the next delivery
 * without writing the line again. Keys being sent right now are skipped, so
 * concurrent redeliveries do not double-page. Memory is bounded; the oldest
 * are dropped.
 */
export async function alertOncePerEvent(
  key: string,
  alert: { log: () => void; send: () => Promise<boolean> }
): Promise<void> {
  if (inFlight.has(key)) return;
  if (alerted.has(key)) {
    if (!posthogPending.has(key)) return;
  } else {
    alert.log();
    alerted.add(key);
    posthogPending.add(key);
    if (alerted.size > MAX_REMEMBERED_EVENTS) {
      const oldest = alerted.values().next().value;
      if (oldest !== undefined) {
        alerted.delete(oldest);
        posthogPending.delete(oldest);
      }
    }
  }
  inFlight.add(key);
  try {
    if (await alert.send()) posthogPending.delete(key);
  } catch {
    // Stays pending; the next delivery retries the PostHog send only.
  } finally {
    inFlight.delete(key);
  }
}

export function resetUnmappedAlertMemoryForTests(): void {
  alerted.clear();
  posthogPending.clear();
  inFlight.clear();
}

/** A stable, PostHog-safe id for a provider transaction id. */
function operationIdFor(txn: string): string {
  return SAFE_IDENTIFIER.test(txn)
    ? txn
    : `txn_${createHash('sha256').update(txn).digest('hex').slice(0, 32)}`;
}

/**
 * Page an operator once per deposit (provider transaction, since a redelivery
 * may carry a new event id) while the delivery stays retryable: the mapping
 * may still be committing. Once per provider transaction per server instance
 * on the primary log channel; PostHog is best effort. It never rejects and
 * never changes the retry outcome. Callers await it so the PostHog send is
 * not cut off when the invocation ends.
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
    const rawTxn =
      event.eventType === 'bank-transfer.inflow.success'
        ? event.eventData.transaction_id
        : null;
    // Only a real id keys the deposit: a missing one must not become the
    // shared string 'undefined' and silence later deposits.
    const txn =
      (typeof rawTxn === 'string' && rawTxn.length > 0) ||
      (typeof rawTxn === 'number' && Number.isFinite(rawTxn))
        ? String(rawTxn)
        : null;
    const alertKey = txn ? `txn:${txn}` : `event:${event.eventId}`;
    // The PostHog identity follows the deposit, so a redelivery with a new
    // event id (even on another instance) does not create a second event.
    const detail = {
      eventType: event.eventType,
      operationId: txn ? operationIdFor(txn) : event.eventId,
    };
    await alertOncePerEvent(alertKey, {
      log: () => logPiggyvestWebhookAlert('PIGGYVEST_INFLOW_UNMAPPED', detail),
      send: () =>
        sendPiggyvestWebhookAlertDelivered('PIGGYVEST_INFLOW_UNMAPPED', detail),
    });
  } catch {
    // Alerting must not affect the money path.
  }
}

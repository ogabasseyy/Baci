import 'server-only';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';

/**
 * Pages when a redelivered credit dedupes on pvb_reference (same money and
 * attribution) but its audit-only eventData fields differ. The ledger still
 * treats it as a duplicate: PiggyVest names pvb_reference as the unique
 * credit key (2026-11-11) and does not promise its internals stable across
 * retries. The page keeps a reused pvb_reference or provider bug visible.
 * Only field names leave this function, never values.
 */
// Page the first drift per pvb_reference per instance: if PiggyVest rotates
// internals on every retry, later redeliveries of the same credit would
// otherwise page again. The money path is already safe (deduped). Bounded
// so a long-lived instance cannot grow it without limit.
const MAX_REMEMBERED = 1000;
const paged = new Set<string>();

export function alertCreditAuditDrift(input: {
  eventType: 'bank-transfer.inflow.success' | 'interest-payout.success';
  pvbReference: string;
  driftedFields: readonly string[];
}): void {
  if (input.driftedFields.length === 0) return;
  if (paged.has(input.pvbReference)) return;
  if (paged.size >= MAX_REMEMBERED) paged.clear();
  paged.add(input.pvbReference);
  emitPiggyvestWebhookAlert('PIGGYVEST_CREDIT_AUDIT_DRIFT', {
    eventType: input.eventType,
    operationId: input.pvbReference,
    reason: `same pvb_reference, audit fields differ: ${input.driftedFields.join(', ')}`,
  });
}

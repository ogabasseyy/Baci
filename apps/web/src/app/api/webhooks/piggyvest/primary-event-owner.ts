import type { PiggyvestWebhookKeyFamily } from '@/lib/piggyvest/webhook-secret-union';

/**
 * The key family whose primary intake owns an event type. It mirrors the
 * family gates in primary-webhook-dispatch.ts (custody outflow, paid
 * interest, bank inflow); the table-driven tests in
 * process-delivery.incomplete-keys.test.ts pin the two together.
 *
 * Under an incomplete key set a delivery of one of these types counts as
 * completed only when its owning intake actually ran, which requires the
 * owning family to be among the loaded families.
 */
const PRIMARY_OWNER_FAMILY: ReadonlyMap<string, PiggyvestWebhookKeyFamily> =
  new Map([
    ['wallet-transfer.outflow.success', 'custody'],
    ['interest-payout.success', 'interest'],
    ['bank-transfer.inflow.success', 'bank'],
  ]);

export function primaryOwnerFamily(
  eventType: string
): PiggyvestWebhookKeyFamily | undefined {
  return PRIMARY_OWNER_FAMILY.get(eventType);
}

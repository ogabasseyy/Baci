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

/**
 * Event types the legacy handler only RECORDS (no ledger write), which a
 * second key family may legitimately deliver. The interest integration
 * sends its daily accruals signed with the interest key, never the legacy
 * one, so without this they would be quarantined for the wrong family
 * forever. Everything else stays legacy-only: a narrow family key must not
 * authorize legacy ledger writes.
 */
const RECORD_ONLY_FAMILIES: ReadonlyMap<
  string,
  readonly PiggyvestWebhookKeyFamily[]
> = new Map([['interest-accrued.success', ['interest']]]);

export function authorizesLegacyHandling(
  eventType: string,
  families: readonly PiggyvestWebhookKeyFamily[]
): boolean {
  if (families.includes('legacy')) return true;
  const allowed = RECORD_ONLY_FAMILIES.get(eventType) ?? [];
  return allowed.some((family) => families.includes(family));
}

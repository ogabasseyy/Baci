import 'server-only';
import { dispatchPrimaryPiggyvestIntake } from '@/app/api/webhooks/piggyvest/primary-webhook-dispatch';
import { piggyvestWebhookEventSchema } from '@/schemas/piggyvest/events';
import {
  authorizesLegacyHandling,
  primaryOwnerFamily,
} from './primary-event-owner';
import type {
  ReplayDelivery,
  ReplayProcessResult,
} from './webhook-capture-drain';

/**
 * Processing step of the worker-host capture drain (R5): the receiver's
 * pipeline (process-delivery.ts) restricted to the primary intakes, each of
 * which writes through its own dedicated database login. This module never
 * builds or receives a service-role client.
 *
 * Where the receiver would write through the service role, this step
 * writes nothing and reports a marker instead, so the drain settles the
 * captured row (the row itself is the durable evidence):
 * - unparseable or unknown bytes: content quarantine (parked for review);
 * - a delivery no primary intake owns and no legacy path may take:
 *   authorization quarantine (parked), or a key-set retry while the key
 *   set is incomplete;
 * - an inflow redelivery conflict: conflict (parked for review);
 * - anything only the legacy path could finish (a record-only event, a
 *   legacy-authorized delivery no primary intake claimed): out of scope,
 *   deferred with an alert and left to the receiver's own retry.
 */
export async function replayPrimaryDelivery(
  delivery: ReplayDelivery
): Promise<ReplayProcessResult> {
  const { rawBody, signature, matchedSecret, families, incompleteKeySet } =
    delivery;
  let payload: unknown;
  try {
    payload = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(rawBody)
    );
  } catch {
    return { status: 200, contentQuarantine: true };
  }
  const parsed = piggyvestWebhookEventSchema.safeParse(payload);
  if (!parsed.success) return { status: 200, contentQuarantine: true };
  const event = parsed.data;

  // Same rule as the receiver: while the key set is incomplete, an owned
  // event counts as completed only if its owning family loaded and ran.
  const owner = primaryOwnerFamily(event.eventType);
  const ownerSkipped =
    incompleteKeySet === true &&
    owner !== undefined &&
    !families.includes(owner);

  let primary: Response | 'conflict' | null;
  try {
    primary = await dispatchPrimaryPiggyvestIntake({
      rawBody,
      signature,
      matchedSecret,
      event,
      families,
      keyScope: 'replay',
    });
  } catch {
    return { status: 503 };
  }
  if (ownerSkipped) return { status: 503, keySetIncomplete: true };
  if (primary === 'conflict') return { status: 200, conflict: true };
  if (primary) return { status: primary.status };

  if (!authorizesLegacyHandling(event.eventType, families)) {
    return incompleteKeySet === true
      ? { status: 503, keySetIncomplete: true }
      : { status: 200, authorizationQuarantine: true };
  }
  return { status: 503, outOfScope: 'LEGACY_PATH' };
}

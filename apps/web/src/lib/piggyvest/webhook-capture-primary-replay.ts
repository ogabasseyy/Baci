import 'server-only';
import {
  dispatchPrimaryPiggyvestIntake,
  isKillSwitchDeferral,
} from '@/app/api/webhooks/piggyvest/primary-webhook-dispatch';
import {
  authorizesLegacyHandling,
  primaryOwnerFamily,
} from './primary-event-owner';
import type {
  ReplayDelivery,
  ReplayProcessResult,
} from './webhook-capture-drain';
import { parseStoredPiggyvestEvent } from './webhook-capture-stored-event';

/**
 * Processing step of the worker-host capture drain (R5): the receiver's
 * pipeline (process-delivery.ts) restricted to the primary intakes, each of
 * which writes through its own dedicated database login. This module never
 * builds or receives a service-role client.
 *
 * Where the receiver would use its inline-only restricted intake, this step
 * writes nothing and reports a marker instead, so the drain settles the
 * captured row (the row itself is the durable evidence):
 * - unparseable or unknown bytes: content quarantine (parked for review);
 * - a delivery no primary intake owns and no legacy path may take:
 *   authorization quarantine (parked), or a key-set retry while the key
 *   set is incomplete;
 * - an inflow redelivery conflict: conflict (parked for review);
 * - anything only the legacy path could finish (a record-only event, a
 *   legacy-authorized delivery no primary intake claimed): out of scope,
 *   set aside for review with an alert; a provider redelivery the
 *   receiver completes inline still closes it.
 */
export async function replayPrimaryDelivery(
  delivery: ReplayDelivery,
  env: NodeJS.ProcessEnv = process.env
): Promise<ReplayProcessResult> {
  const { rawBody, signature, matchedSecret, families, incompleteKeySet } =
    delivery;
  const event = parseStoredPiggyvestEvent(rawBody);
  if (!event) return { status: 200, contentQuarantine: true };

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
      env,
      keyScope: 'replay',
    });
  } catch {
    return { status: 503 };
  }
  if (ownerSkipped) return { status: 503, keySetIncomplete: true };
  if (primary === 'conflict') return { status: 200, conflict: true };
  if (primary) {
    return isKillSwitchDeferral(primary)
      ? { status: primary.status, killSwitchDeferred: true }
      : { status: primary.status };
  }

  // Whether the legacy path may take it is judged on what admission
  // recorded: the worker host holds no legacy key, so its verification
  // never reports the legacy family even for a secret the web app also
  // holds as the legacy key. Setting a row aside grants nothing, so the
  // wider recorded set cannot widen authority; processing above used only
  // the narrowed `families`.
  if (authorizesLegacyHandling(event.eventType, delivery.recordedFamilies)) {
    return { status: 503, outOfScope: 'LEGACY_PATH' };
  }
  return incompleteKeySet === true
    ? { status: 503, keySetIncomplete: true }
    : { status: 200, authorizationQuarantine: true };
}

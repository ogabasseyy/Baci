import 'server-only';
import {
  dispatchPrimaryPiggyvestIntake,
  isKillSwitchDeferral,
} from '@/app/api/webhooks/piggyvest/primary-webhook-dispatch';
import {
  authorizesLegacyHandling,
  primaryOwnerFamily,
} from './primary-event-owner';
import { isPiggyvestCaptureLegacyReplayEnabled } from './webhook-capture-attestation';
import type {
  ReplayDelivery,
  ReplayProcessResult,
} from './webhook-capture-drain';
import { replayLegacyDelivery } from './webhook-capture-legacy-replay';
import { isPrimaryLegacyBankInflowUnavailable } from './webhook-capture-primary-intake-readiness';
import { parseStoredPiggyvestEvent } from './webhook-capture-stored-event';
import { isPiggyvestWebhookIntakeRuntimeReady } from './webhook-intake-runtime';

/**
 * Processing step of the worker-host capture drain (R5): primary intakes
 * use their dedicated logins; optional legacy replay reuses the receiver's
 * restricted webhook-intake client. This module never builds or receives a
 * service-role client.
 *
 * Where a legacy path is disabled, this step writes nothing and reports a
 * marker instead, so the drain settles the captured row (the row itself is
 * durable evidence):
 * - unparseable or unknown bytes: content quarantine (parked for review);
 * - a delivery no primary intake owns and no legacy path may take:
 *   authorization quarantine (parked), or a key-set retry while the key
 *   set is incomplete;
 * - an inflow redelivery conflict: conflict (parked for review);
 * - anything only the disabled legacy path could finish (a record-only
 *   event, a legacy-authorized delivery no primary intake claimed): out of
 *   scope and set aside for review with an alert.
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
    // Legacy-signed bank inflows also enter the optional direct primary
    // fallback. With no bank-family signature there is no bank inbox that
    // could handle the row first; broken fallback config is not a row error.
    if (
      isPiggyvestCaptureLegacyReplayEnabled(env) &&
      owner === 'bank' &&
      families.includes('legacy') &&
      !families.includes('bank') &&
      isPrimaryLegacyBankInflowUnavailable(env)
    )
      return { status: 503, primaryInflowUnavailable: true };
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

  // Both current replay verification and immutable admission evidence must
  // authorize the legacy handler. The recorded set is never authority by
  // itself.
  if (
    isPiggyvestCaptureLegacyReplayEnabled(env) &&
    authorizesLegacyHandling(event.eventType, families) &&
    authorizesLegacyHandling(event.eventType, delivery.recordedFamilies)
  ) {
    // A ready primary intake can decline a legacy wallet. Check the fallback
    // only after that decline, so missing legacy configuration cannot either
    // block primary successes or exhaust a mixed-family capture's attempts.
    if (!isPiggyvestWebhookIntakeRuntimeReady(env))
      return { status: 503, legacyIntakeUnavailable: true };
    return replayLegacyDelivery(delivery, env);
  }
  if (authorizesLegacyHandling(event.eventType, delivery.recordedFamilies))
    return { status: 503, outOfScope: 'LEGACY_PATH' };
  return incompleteKeySet === true
    ? { status: 503, keySetIncomplete: true }
    : { status: 200, authorizationQuarantine: true };
}

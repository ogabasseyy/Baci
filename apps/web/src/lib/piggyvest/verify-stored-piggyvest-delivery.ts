import 'server-only';
import {
  collectPiggyvestWebhookSecretsWithStatus,
  matchPiggyvestWebhookSecretWithFamilies,
  type PiggyvestWebhookKeyFamily,
  type PiggyvestWebhookKeyStatus,
} from './webhook-secret-union';

export type StoredPiggyvestDeliveryVerification =
  | { status: 'unconfigured' }
  | { status: 'unverifiable' }
  /**
   * Authentic, but the key holds none of the families recorded at admission
   * and the key set is complete, so this is terminal. An incomplete key set
   * reports `unconfigured` instead.
   */
  | { status: 'authority_lost' }
  | {
      status: 'verified';
      secret: string;
      families: PiggyvestWebhookKeyFamily[];
      keyVersion: string;
      keyStatus: PiggyvestWebhookKeyStatus;
      /** Part of the key set was unavailable; see the ingress verdict. */
      incompleteKeySet?: boolean;
      /**
       * Every family the matched key holds right now, BEFORE narrowing to
       * what admission recorded. Replay authority is `families`; this only
       * lets the drain tell an owning family that was dropped or never
       * recorded from one the key never held.
       */
      keyFamilies?: PiggyvestWebhookKeyFamily[];
    };

/**
 * Processing authority of a replayed row: the intersection of the families
 * replay verification reports and the families durably recorded at
 * admission. Replay re-proves authenticity; it must never WIDEN authority.
 * A secret that is current for one family but also appears under another
 * (for example an expired archived assignment, which replay still counts)
 * would otherwise let a delivery quarantined at ingress reach a handler it
 * was never authorised for.
 */
export function narrowToRecordedFamilies(
  replayFamilies: readonly PiggyvestWebhookKeyFamily[],
  recordedFamilies: readonly PiggyvestWebhookKeyFamily[]
): PiggyvestWebhookKeyFamily[] {
  return replayFamilies.filter((family) => recordedFamilies.includes(family));
}

/**
 * Replay-time re-check of a stored request. Unlike ingress, archived keys
 * past the overlap still count: that is what retained keys are for. The
 * result never authorizes a new request; it only proves the stored bytes
 * were genuinely signed by a key this deployment has issued or accepted.
 * With `recordedFamilies` (what ingress stored) the reported families are
 * narrowed to that set so replay can never grant more than admission did.
 */
export function verifyStoredPiggyvestDelivery(input: {
  rawBody: Uint8Array;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
  recordedFamilies?: readonly PiggyvestWebhookKeyFamily[];
}): StoredPiggyvestDeliveryVerification {
  const { secrets, replayOnly, misconfigured } =
    collectPiggyvestWebhookSecretsWithStatus(input.env, input.now);
  const candidates = [...secrets, ...replayOnly];
  if (candidates.length === 0) return { status: 'unconfigured' };
  const match = matchPiggyvestWebhookSecretWithFamilies({
    ...input,
    secrets: candidates,
  });
  if (match) {
    if (!input.recordedFamilies)
      return {
        status: 'verified',
        ...match,
        keyFamilies: match.families,
        incompleteKeySet: misconfigured,
      };
    const families = narrowToRecordedFamilies(
      match.families,
      input.recordedFamilies
    );
    if (families.length > 0)
      return {
        status: 'verified',
        ...match,
        families,
        keyFamilies: match.families,
        incompleteKeySet: misconfigured,
      };
    // An empty intersection proves authority was lost only when the key set
    // is complete. With an unreadable archive or a family that failed to
    // load, the assignment that carried the recorded family may simply not
    // be loaded (the key can match another family in the meantime), so the
    // verdict is retryable, never terminal. Nothing is granted either way:
    // authority never exceeds the families recorded at admission.
    return misconfigured
      ? { status: 'unconfigured' }
      : { status: 'authority_lost' };
  }
  // An incomplete key set (unreadable archive, a family that failed to
  // load) cannot prove a stored body is unauthentic: the key that signed
  // it may be the one we failed to load. Report it retryable, never
  // terminal, exactly as ingress does.
  return misconfigured
    ? { status: 'unconfigured' }
    : { status: 'unverifiable' };
}

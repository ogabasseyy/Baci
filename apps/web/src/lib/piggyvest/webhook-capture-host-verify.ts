import 'server-only';
import {
  type StoredPiggyvestDeliveryVerification,
  verifyStoredPiggyvestDelivery,
} from './verify-stored-piggyvest-delivery';
import { emitPiggyvestWebhookAlert } from './webhook-alerts';
import { derivePiggyvestKeyVersion } from './webhook-key-archive';
import {
  collectPiggyvestWebhookSecretsWithStatus,
  type PiggyvestWebhookKeyFamily,
} from './webhook-secret-union';

/**
 * Replay verification on the worker host (R5). The host loads its own copy
 * of the signing keys, which can lag the web app's: a family not configured
 * here, or a rotation not yet copied over. A stored row signed by a key the
 * host does not hold says nothing about the row, so it is reported
 * `unconfigured` (deferred: the attempt is refunded and the row is never
 * dead-lettered) with an alert, instead of `unverifiable` (parked as a
 * possible forgery). Only a row whose key version this host does hold, yet
 * whose signature fails, stays unverifiable.
 *
 * The same lag applies to one assignment of a secret the web app shares
 * between families: when the matched key here lacks a primary family that
 * admission recorded, the key set counts as incomplete (failures defer
 * instead of parking), and a match that holds none of the recorded
 * families is deferred instead of judged authority-lost. Nothing is granted
 * either way: processing authority stays the families loaded here. The
 * legacy family never counts as missing; this host holds it by design.
 */
export function verifyOnWorkerHost(input: {
  rawBody: Uint8Array;
  signature: string;
  recordedFamilies: readonly PiggyvestWebhookKeyFamily[];
  keyVersion: string;
  captureId: string;
  env: NodeJS.ProcessEnv;
  now: Date;
}): StoredPiggyvestDeliveryVerification {
  const result = verifyStoredPiggyvestDelivery(input);
  const primaryRecorded = input.recordedFamilies.filter(
    (family) => family !== 'legacy'
  );
  if (result.status === 'verified') {
    const held = result.keyFamilies ?? result.families;
    const missing = primaryRecorded.some((family) => !held.includes(family));
    return missing ? { ...result, incompleteKeySet: true } : result;
  }
  if (result.status === 'authority_lost' && primaryRecorded.length > 0) {
    return hostKeysUnconfigured(input, 'the recorded family is not loaded');
  }
  if (result.status !== 'unverifiable') return result;
  const { secrets, replayOnly } = collectPiggyvestWebhookSecretsWithStatus(
    input.env,
    input.now
  );
  const held = [...secrets, ...replayOnly].some(
    (key) =>
      (key.version ?? derivePiggyvestKeyVersion(key.secret)) ===
      input.keyVersion
  );
  return held
    ? result
    : hostKeysUnconfigured(input, 'no key of the recorded version');
}

function hostKeysUnconfigured(
  input: { captureId: string; keyVersion: string },
  why: string
): StoredPiggyvestDeliveryVerification {
  emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED', {
    captureId: input.captureId,
    keyVersion: input.keyVersion,
    reason: `replay deferred on the worker host: ${why}`,
  });
  return { status: 'unconfigured' };
}

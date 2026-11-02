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
 * whose signature fails, stays unverifiable. Nothing is granted either way.
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
  if (held) return result;
  emitPiggyvestWebhookAlert('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED', {
    captureId: input.captureId,
    keyVersion: input.keyVersion,
    reason: 'replay deferred: this host holds no key of the recorded version',
  });
  return { status: 'unconfigured' };
}

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
  | {
      status: 'verified';
      secret: string;
      families: PiggyvestWebhookKeyFamily[];
      keyVersion: string;
      keyStatus: PiggyvestWebhookKeyStatus;
    };

/**
 * Replay-time re-check of a stored request. Unlike ingress, archived keys
 * past the overlap still count: that is what retained keys are for. The
 * result never authorizes a new request; it only proves the stored bytes
 * were genuinely signed by a key this deployment has issued or accepted.
 */
export function verifyStoredPiggyvestDelivery(input: {
  rawBody: Uint8Array;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): StoredPiggyvestDeliveryVerification {
  const { secrets, replayOnly, misconfigured } =
    collectPiggyvestWebhookSecretsWithStatus(input.env, input.now);
  const candidates = [...secrets, ...replayOnly];
  if (candidates.length === 0) return { status: 'unconfigured' };
  const match = matchPiggyvestWebhookSecretWithFamilies({
    ...input,
    secrets: candidates,
  });
  if (match) return { status: 'verified', ...match };
  // An incomplete key set (unreadable archive, a family that failed to
  // load) cannot prove a stored body is unauthentic: the key that signed
  // it may be the one we failed to load. Report it retryable, never
  // terminal, exactly as ingress does.
  return misconfigured
    ? { status: 'unconfigured' }
    : { status: 'unverifiable' };
}

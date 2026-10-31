import 'server-only';
import { readPrimaryWalletBankInboxSecrets } from './primary-wallet-bank-inbox-runtime';
import { readPrimaryCardCustodyIntakeSecrets } from './primary-wallet-card-custody-intake-runtime';
import { readPrimaryWalletPaidInterestInboxSecrets } from './primary-wallet-paid-interest-inbox-runtime';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';
import {
  derivePiggyvestKeyVersion,
  partitionArchivedKeys,
  readWebhookKeyArchive,
  type WebhookKeyArchiveIssue,
} from './webhook-key-archive';

interface WebhookSecretConfig {
  webhookSecret?: unknown;
  retainedWebhookSecrets?: unknown;
}

// Leaf copy of the legacy HMAC getter for routes that must not import
// `@/env`: env.ts is the service credential authority, which the
// event-pipeline boundary forbids for new import graphs. Keep the alias
// chain identical to getPiggyvestWebhookSecret (PIGGYVEST_SECRET_KEY, then
// PVB_SECRET_KEY); both resolve from the same process environment.
function readLegacyWebhookSecret(env: NodeJS.ProcessEnv): string | undefined {
  return env.PIGGYVEST_SECRET_KEY ?? env.PVB_SECRET_KEY;
}

export type PiggyvestWebhookKeyFamily =
  | 'legacy'
  | 'bank'
  | 'custody'
  | 'interest';

/**
 * Where a key stands at ingress:
 * - `current`: configured key, always accepted;
 * - `overlap`: rotated out but inside the bounded overlap window, still
 *   accepted for new deliveries;
 * - `replay-only`: rotated out and past the window. Never accepted for a
 *   new delivery; it only re-checks bodies that were already stored.
 */
export type PiggyvestWebhookKeyStatus = 'current' | 'overlap' | 'replay-only';

export interface PiggyvestFamilySecret {
  secret: string;
  family: PiggyvestWebhookKeyFamily;
  /** Operator label for archived keys; derived (non-secret) otherwise. */
  version?: string;
  status?: PiggyvestWebhookKeyStatus;
}

/**
 * Every webhook secret a downstream intake would accept, tagged with the
 * key family that configured it. The outer route accepts this union —
 * otherwise a delivery signed with a retained key is 200-ACKed as invalid
 * and a durable signed payout is silently dropped during rotation — but
 * the matched family then binds which handlers may act on the delivery.
 */
export function collectPiggyvestWebhookSecretsWithFamilies(
  env: NodeJS.ProcessEnv = process.env
): PiggyvestFamilySecret[] {
  return collectPiggyvestWebhookSecretsWithStatus(env).secrets.map(
    ({ secret, family }) => ({ secret, family })
  );
}

export function collectPiggyvestWebhookSecrets(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  return [
    ...new Set(
      collectPiggyvestWebhookSecretsWithFamilies(env).map(
        (candidate) => candidate.secret
      )
    ),
  ];
}

interface CollectedKeys {
  /** Keys accepted for new deliveries: current plus in-overlap archived. */
  secrets: PiggyvestFamilySecret[];
  /** Archived keys past the overlap: replay re-checks only. */
  replayOnly: PiggyvestFamilySecret[];
  misconfigured: boolean;
  /** Why the retired-key archive could not be used, when it could not. */
  archiveIssue?: WebhookKeyArchiveIssue;
}

export function collectPiggyvestWebhookSecretsWithStatus(
  env: NodeJS.ProcessEnv = process.env,
  now: Date = new Date()
): CollectedKeys {
  // Secrets-only readers: key material survives incomplete provisioning
  // (missing database password, unparseable scope, expired worker) so the
  // outer gate verifies and the unready intake answers a retryable 503
  // instead of the delivery being 200-ACKed as invalid and lost.
  const readers: [
    PiggyvestWebhookKeyFamily,
    () => WebhookSecretConfig | null,
  ][] = [
    ['bank', () => readPrimaryWalletBankInboxSecrets(env)],
    ['custody', () => readPrimaryCardCustodyIntakeSecrets(env)],
    ['interest', () => readPrimaryWalletPaidInterestInboxSecrets(env)],
  ];
  const secrets: PiggyvestFamilySecret[] = [];
  const replayOnly: PiggyvestFamilySecret[] = [];
  let misconfigured = false;
  const seen = new Set<string>();
  const push = (candidate: unknown, family: PiggyvestWebhookKeyFamily) => {
    if (
      typeof candidate === 'string' &&
      candidate.trim() &&
      !seen.has(`${family}:${candidate}`)
    ) {
      seen.add(`${family}:${candidate}`);
      secrets.push({
        secret: candidate,
        family,
        version: derivePiggyvestKeyVersion(candidate),
        status: 'current',
      });
    }
  };
  push(readLegacyWebhookSecret(env), 'legacy');
  for (const [family, read] of readers) {
    try {
      const config = read();
      if (!config) continue;
      push(config.webhookSecret, family);
      if (Array.isArray(config.retainedWebhookSecrets))
        for (const retained of config.retainedWebhookSecrets)
          push(retained, family);
    } catch {
      // Disabled runtimes return null above; a throw means the family is
      // configured but unreadable (e.g. malformed retained-key JSON), so
      // its key set is incomplete. Healthy families still contribute,
      // but verification must not call an unmatched delivery invalid:
      // it may be signed with a key we failed to load.
      misconfigured = true;
    }
  }
  // Archived (retired) keys: accepted only inside the overlap window, and
  // never shadowing a key that is current under the same family.
  const archive = readWebhookKeyArchive(env);
  let archiveIssue: WebhookKeyArchiveIssue | undefined;
  if (!archive.ok) {
    misconfigured = true;
    archiveIssue = archive.reason;
  } else {
    const { overlap, replayOnly: expired } = partitionArchivedKeys(
      archive,
      now
    );
    const current = new Set(
      secrets.map((key) => `${key.family}:${key.secret}`)
    );
    const add = (
      entries: typeof overlap,
      target: PiggyvestFamilySecret[],
      status: PiggyvestWebhookKeyStatus
    ) => {
      for (const entry of entries) {
        if (current.has(`${entry.family}:${entry.secret}`)) continue;
        target.push({
          secret: entry.secret,
          family: entry.family,
          version: entry.version,
          status,
        });
      }
    };
    add(overlap, secrets, 'overlap');
    add(expired, replayOnly, 'replay-only');
  }
  return { secrets, replayOnly, misconfigured, archiveIssue };
}

/**
 * Returns the first secret that verifies the delivery. The matched secret
 * flows on to re-verifying handlers so every layer agrees.
 */
export function matchPiggyvestWebhookSecret(input: {
  rawBody: Uint8Array;
  signature: string | null;
  secrets: readonly string[];
}): string | undefined {
  return input.secrets.find((secret) =>
    verifyPiggyvestPayloadSignature({
      payload: input.rawBody,
      signature: input.signature,
      secret,
    })
  );
}

/**
 * Returns the matched secret with every family that configured that value.
 * A secret shared across families authorizes each of them.
 */
export function matchPiggyvestWebhookSecretWithFamilies(input: {
  rawBody: Uint8Array;
  signature: string | null;
  secrets: readonly PiggyvestFamilySecret[];
}):
  | {
      secret: string;
      families: PiggyvestWebhookKeyFamily[];
      keyVersion: string;
      keyStatus: PiggyvestWebhookKeyStatus;
    }
  | undefined {
  const match = input.secrets.find((candidate) =>
    verifyPiggyvestPayloadSignature({
      payload: input.rawBody,
      signature: input.signature,
      secret: candidate.secret,
    })
  );
  if (!match) return undefined;
  const sameSecret = input.secrets.filter(
    (candidate) => candidate.secret === match.secret
  );
  const families = [
    ...new Set(sameSecret.map((candidate) => candidate.family)),
  ];
  // A secret that is current under any family is current; otherwise the
  // first (earliest-ordered) entry names its version and status.
  const labelled =
    sameSecret.find((candidate) => candidate.status === 'current') ?? match;
  return {
    secret: match.secret,
    families,
    keyVersion: labelled.version ?? derivePiggyvestKeyVersion(match.secret),
    keyStatus: labelled.status ?? 'current',
  };
}

export type PiggyvestWebhookVerification =
  | { status: 'unconfigured' }
  | { status: 'invalid' }
  | { status: 'revoked'; keyVersion: string }
  | {
      status: 'verified';
      secret: string;
      families: PiggyvestWebhookKeyFamily[];
      keyVersion?: string;
      keyStatus?: Exclude<PiggyvestWebhookKeyStatus, 'replay-only'>;
      /**
       * Part of the key set could not be loaded (unreadable archive, failed
       * family), so `families` is only what WAS loaded: treat "not
       * authorized" as retryable, never terminal.
       */
      incompleteKeySet?: boolean;
    };

/**
 * Single entry point for the outer gate: collects every secret a
 * downstream intake trusts, then reports whether this delivery verifies
 * and which key families the matched secret authorizes.
 *
 * Only keys accepted at ingress participate: current keys and archived
 * keys inside the overlap window. A signature that only a revoked
 * (replay-only) key can produce is reported as `revoked`, distinct from
 * `invalid`, so operators can tell a stale provider key from forgery.
 */
export function verifyPiggyvestWebhookSecrets(input: {
  rawBody: Uint8Array;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
  now?: Date;
}): PiggyvestWebhookVerification {
  const { secrets, replayOnly, misconfigured } =
    collectPiggyvestWebhookSecretsWithStatus(input.env, input.now);
  // No current key means the server is not configured to receive anything:
  // an overlap key alone is a half-finished rotation, not a configuration.
  if (!secrets.some((key) => key.status === 'current')) {
    return { status: 'unconfigured' };
  }
  const match = matchPiggyvestWebhookSecretWithFamilies({ ...input, secrets });
  // No loaded key matches: invalid, unless a family failed to load. Then the
  // delivery may be legitimate, so report unconfigured (retryable 503).
  if (!match) {
    if (misconfigured) return { status: 'unconfigured' };
    const revoked = matchPiggyvestWebhookSecretWithFamilies({
      ...input,
      secrets: replayOnly,
    });
    return revoked
      ? { status: 'revoked', keyVersion: revoked.keyVersion }
      : { status: 'invalid' };
  }
  return {
    status: 'verified',
    secret: match.secret,
    families: match.families,
    keyVersion: match.keyVersion,
    keyStatus: match.keyStatus === 'overlap' ? 'overlap' : 'current',
    incompleteKeySet: misconfigured,
  };
}

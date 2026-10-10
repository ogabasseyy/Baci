import 'server-only';
import { readPrimaryWalletBankInboxSecrets } from './primary-wallet-bank-inbox-runtime';
import { readPrimaryCardCustodyIntakeSecrets } from './primary-wallet-card-custody-intake-runtime';
import { readPrimaryWalletPaidInterestInboxSecrets } from './primary-wallet-paid-interest-inbox-runtime';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

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

export interface PiggyvestFamilySecret {
  secret: string;
  family: PiggyvestWebhookKeyFamily;
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
  return collectPiggyvestWebhookSecretsWithStatus(env).secrets;
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

function collectPiggyvestWebhookSecretsWithStatus(
  env: NodeJS.ProcessEnv = process.env
): { secrets: PiggyvestFamilySecret[]; misconfigured: boolean } {
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
  let misconfigured = false;
  const seen = new Set<string>();
  const push = (candidate: unknown, family: PiggyvestWebhookKeyFamily) => {
    if (
      typeof candidate === 'string' &&
      candidate.trim() &&
      !seen.has(`${family}:${candidate}`)
    ) {
      seen.add(`${family}:${candidate}`);
      secrets.push({ secret: candidate, family });
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
  return { secrets, misconfigured };
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
}): { secret: string; families: PiggyvestWebhookKeyFamily[] } | undefined {
  const match = input.secrets.find((candidate) =>
    verifyPiggyvestPayloadSignature({
      payload: input.rawBody,
      signature: input.signature,
      secret: candidate.secret,
    })
  );
  if (!match) return undefined;
  const families = [
    ...new Set(
      input.secrets
        .filter((candidate) => candidate.secret === match.secret)
        .map((candidate) => candidate.family)
    ),
  ];
  return { secret: match.secret, families };
}

export type PiggyvestWebhookVerification =
  | { status: 'unconfigured' }
  | { status: 'invalid' }
  | {
      status: 'verified';
      secret: string;
      families: PiggyvestWebhookKeyFamily[];
    };

/**
 * Single entry point for the outer gate: collects every secret a
 * downstream intake trusts, then reports whether this delivery verifies
 * and which key families the matched secret authorizes.
 */
export function verifyPiggyvestWebhookSecrets(input: {
  rawBody: Uint8Array;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
}): PiggyvestWebhookVerification {
  const { secrets, misconfigured } = collectPiggyvestWebhookSecretsWithStatus(
    input.env
  );
  if (secrets.length === 0) return { status: 'unconfigured' };
  const match = matchPiggyvestWebhookSecretWithFamilies({ ...input, secrets });
  // A delivery that matches no loaded key is invalid — unless a family
  // failed to load, in which case the key set is incomplete and the
  // delivery may be legitimate. Report unconfigured (retryable 503) so
  // the provider retries instead of the route 200-acking it as invalid.
  if (!match) return { status: misconfigured ? 'unconfigured' : 'invalid' };
  return { status: 'verified', secret: match.secret, families: match.families };
}

import 'server-only';
import { readPrimaryWalletBankInboxRuntime } from './primary-wallet-bank-inbox-runtime';
import { readPrimaryCardCustodyIntakeRuntime } from './primary-wallet-card-custody-intake-runtime';
import { readPrimaryWalletPaidInterestInboxRuntime } from './primary-wallet-paid-interest-inbox-runtime';
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

/**
 * Every webhook secret a downstream intake would accept: the legacy shared
 * secret plus each enabled primary inbox's current and retained keys.
 * The outer route must accept this union — otherwise a delivery signed
 * with a retained key is 200-ACKed as invalid and a durable signed payout
 * is silently dropped during secret rotation.
 */
export function collectPiggyvestWebhookSecrets(
  env: NodeJS.ProcessEnv = process.env
): string[] {
  const readers: Array<() => WebhookSecretConfig | null> = [
    () => readPrimaryWalletBankInboxRuntime('intake', env),
    () => readPrimaryCardCustodyIntakeRuntime(env),
    () => readPrimaryWalletPaidInterestInboxRuntime(env),
  ];
  const candidates: unknown[] = [readLegacyWebhookSecret(env)];
  for (const read of readers) {
    try {
      const config = read();
      if (!config) continue;
      candidates.push(config.webhookSecret);
      if (Array.isArray(config.retainedWebhookSecrets))
        candidates.push(...config.retainedWebhookSecrets);
    } catch {
      // Disabled or misconfigured runtimes contribute no secrets.
    }
  }
  const secrets: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (
      typeof candidate === 'string' &&
      candidate.trim() &&
      !seen.has(candidate)
    ) {
      seen.add(candidate);
      secrets.push(candidate);
    }
  }
  return secrets;
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

export type PiggyvestWebhookVerification =
  | { status: 'unconfigured' }
  | { status: 'invalid' }
  | { status: 'verified'; secret: string };

/**
 * Single entry point for the outer gate: collects every secret a
 * downstream intake trusts, then reports whether this delivery verifies.
 */
export function verifyPiggyvestWebhookSecrets(input: {
  rawBody: Uint8Array;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
}): PiggyvestWebhookVerification {
  const secrets = collectPiggyvestWebhookSecrets(input.env);
  if (secrets.length === 0) return { status: 'unconfigured' };
  const secret = matchPiggyvestWebhookSecret({ ...input, secrets });
  if (!secret) return { status: 'invalid' };
  return { status: 'verified', secret };
}

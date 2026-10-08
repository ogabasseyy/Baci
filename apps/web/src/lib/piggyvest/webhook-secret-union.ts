import 'server-only';
import { getPiggyvestWebhookSecret } from '@/env';
import { readPrimaryWalletBankInboxRuntime } from './primary-wallet-bank-inbox-runtime';
import { readPrimaryCardCustodyIntakeRuntime } from './primary-wallet-card-custody-intake-runtime';
import { readPrimaryWalletPaidInterestInboxRuntime } from './primary-wallet-paid-interest-inbox-runtime';

interface WebhookSecretConfig {
  webhookSecret?: unknown;
  retainedWebhookSecrets?: unknown;
}

/**
 * Every webhook secret a downstream intake would accept: the legacy shared
 * secret plus each enabled primary inbox's current and retained keys.
 * The outer route must accept this union — otherwise a delivery signed
 * with a retained key is 200-ACKed as invalid and a durable signed payout
 * is silently dropped during secret rotation.
 */
export function collectPiggyvestWebhookSecrets(): string[] {
  const readers: Array<() => WebhookSecretConfig | null> = [
    () => readPrimaryWalletBankInboxRuntime('intake'),
    () => readPrimaryCardCustodyIntakeRuntime(),
    () => readPrimaryWalletPaidInterestInboxRuntime(),
  ];
  const candidates: unknown[] = [getPiggyvestWebhookSecret()];
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

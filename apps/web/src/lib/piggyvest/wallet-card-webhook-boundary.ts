import { prefundedCardWebhookBoundary } from './prefunded-card-webhook-boundary';
import { primaryWalletCardCheckoutWebhookBoundary } from './primary-wallet-card-checkout-webhook-boundary';

export function walletCardWebhookBoundary(body: unknown): Response | null {
  return (
    primaryWalletCardCheckoutWebhookBoundary(body) ??
    prefundedCardWebhookBoundary(body)
  );
}

import { describe, expect, it } from 'vitest';
import { prefundedCardWebhookBoundary } from './prefunded-card-webhook-boundary';
import { primaryWalletCardCheckoutFixture as fixture } from './primary-wallet-card-checkout.test-fixture';
import { primaryWalletCardCheckoutWebhookBoundary } from './primary-wallet-card-checkout-webhook-boundary';

describe('primary card legacy webhook isolation', () => {
  it('uses a reference family already rejected before legacy wallet credit', () => {
    const event = {
      event: 'charge.success',
      data: {
        reference: fixture.intent.reference,
        metadata: { transaction_type: 'primary_wallet_card_checkout' },
      },
    };
    expect(prefundedCardWebhookBoundary(event)?.status).toBe(503);
    expect(primaryWalletCardCheckoutWebhookBoundary(event)?.status).toBe(503);
  });
  it.each([
    { transaction_type: 'primary_wallet_card_checkout' },
    JSON.stringify({ transaction_type: 'primary_wallet_card_checkout' }),
  ])('protects primary metadata without a recognized reference', (metadata) => {
    expect(
      primaryWalletCardCheckoutWebhookBoundary({
        data: { reference: 'WAL-fixture', metadata },
      })?.status
    ).toBe(503);
  });
  it('does not change recovery of legacy wallet references', () => {
    expect(
      primaryWalletCardCheckoutWebhookBoundary({
        data: {
          reference: 'WAL-fixture',
          metadata: { transaction_type: 'wallet_topup' },
        },
      })
    ).toBeNull();
  });
  it('ignores malformed unrelated metadata', () => {
    expect(
      primaryWalletCardCheckoutWebhookBoundary({
        data: { metadata: '{invalid' },
      })
    ).toBeNull();
  });
});

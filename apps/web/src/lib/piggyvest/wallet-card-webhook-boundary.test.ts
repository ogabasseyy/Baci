import { expect, it } from 'vitest';
import { walletCardWebhookBoundary } from './wallet-card-webhook-boundary';

it('keeps primary collection reconciliation separate from legacy settlement', async () => {
  const response = walletCardWebhookBoundary({
    data: {
      reference: 'unrecognized',
      metadata: JSON.stringify({
        transaction_type: 'primary_wallet_card_checkout',
      }),
    },
  });
  expect(response?.status).toBe(503);
  expect(await response?.json()).toMatchObject({
    code: 'PRIMARY_CARD_WEBHOOK_PENDING',
  });
});

it('preserves the legacy prefunded boundary', async () => {
  const response = walletCardWebhookBoundary({
    data: { reference: 'pvb-first-legacy' },
  });
  expect(await response?.json()).toMatchObject({
    code: 'PREFUNDED_FIRST_CARD_WEBHOOK_UNAVAILABLE',
  });
});

it('does not intercept ordinary wallet top-ups', () => {
  expect(
    walletCardWebhookBoundary({
      data: {
        reference: 'WAL-existing',
        metadata: { transaction_type: 'wallet_topup' },
      },
    })
  ).toBeNull();
});

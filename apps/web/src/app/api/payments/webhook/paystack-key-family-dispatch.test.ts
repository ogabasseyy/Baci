import { createHmac } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ reconcile: vi.fn() }));
vi.mock(
  '@/lib/piggyvest/primary-wallet-card-checkout-webhook-reconcile',
  () => ({
    reconcilePrimaryWalletCardCheckoutWebhook: mocks.reconcile,
  })
);

import {
  dispatchPaystackCheckoutOnlyWebhook,
  matchPaystackWebhookSecrets,
} from './paystack-key-family-dispatch';

const LEGACY_SECRET = 'legacy-secret';
const CHECKOUT_SECRET = 'checkout-secret';
const payload = JSON.stringify({ event: 'charge.success' });
const sign = (secret: string) =>
  createHmac('sha512', secret).update(payload).digest('hex');

const env = {
  NODE_ENV: 'test',
  PAYSTACK_SECRET_KEY: LEGACY_SECRET,
  PIGGYVEST_PRIMARY_CARD_PAYSTACK_SECRET: CHECKOUT_SECRET,
} as NodeJS.ProcessEnv;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.reconcile.mockResolvedValue(null);
});

it('matches the legacy secret alone', () => {
  expect(
    matchPaystackWebhookSecrets(sign(LEGACY_SECRET), payload, env)
  ).toEqual({ legacy: true, checkout: false });
});

it('matches the checkout secret alone', () => {
  expect(
    matchPaystackWebhookSecrets(sign(CHECKOUT_SECRET), payload, env)
  ).toEqual({ legacy: false, checkout: true });
});

it('matches both families when the secrets are equal', () => {
  const shared = {
    ...env,
    PIGGYVEST_PRIMARY_CARD_PAYSTACK_SECRET: LEGACY_SECRET,
  };
  expect(
    matchPaystackWebhookSecrets(sign(LEGACY_SECRET), payload, shared)
  ).toEqual({ legacy: true, checkout: true });
});

it('matches nothing for a foreign signature', () => {
  expect(matchPaystackWebhookSecrets(sign('foreign'), payload, env)).toEqual({
    legacy: false,
    checkout: false,
  });
});

it('matches nothing without a signature or secrets', () => {
  expect(matchPaystackWebhookSecrets(null, payload, env)).toEqual({
    legacy: false,
    checkout: false,
  });
  expect(
    matchPaystackWebhookSecrets(sign(LEGACY_SECRET), payload, {
      NODE_ENV: 'test',
    } as NodeJS.ProcessEnv)
  ).toEqual({ legacy: false, checkout: false });
});

it('returns the reconciled response for a resolved card charge', async () => {
  const reconciled = Response.json({ received: true }, { status: 200 });
  mocks.reconcile.mockResolvedValueOnce(reconciled);
  const body = { event: 'charge.success' };
  await expect(dispatchPaystackCheckoutOnlyWebhook(body)).resolves.toBe(
    reconciled
  );
  expect(mocks.reconcile).toHaveBeenCalledWith({ body });
});

it('returns the retry boundary for an unresolved card-shaped charge', async () => {
  const body = {
    event: 'charge.success',
    data: { reference: 'pvb-first-primary-op-1' },
  };
  const response = await dispatchPaystackCheckoutOnlyWebhook(body);
  expect(response.status).toBe(503);
  expect(response.headers.get('retry-after')).toBe('60');
  expect(await response.json()).toEqual({
    error: 'Primary card reconciliation pending',
    code: 'PRIMARY_CARD_WEBHOOK_PENDING',
  });
});

it('acks a genuinely unrelated delivery without effect', async () => {
  const body = { event: 'charge.success', data: { reference: 'REF123' } };
  const response = await dispatchPaystackCheckoutOnlyWebhook(body);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ message: 'Event ignored' });
});

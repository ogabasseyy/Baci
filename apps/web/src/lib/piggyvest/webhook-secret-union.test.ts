import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bank: vi.fn(),
  custody: vi.fn(),
  interest: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxRuntime: mocks.bank,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeRuntime: mocks.custody,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxRuntime: mocks.interest,
}));

import {
  collectPiggyvestWebhookSecrets,
  matchPiggyvestWebhookSecret,
  verifyPiggyvestWebhookSecrets,
} from './webhook-secret-union';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bank.mockReturnValue(null);
  mocks.custody.mockReturnValue(null);
  mocks.interest.mockReturnValue(null);
});

it('returns only the legacy secret when no primary inbox is enabled', () => {
  expect(
    collectPiggyvestWebhookSecrets({
      NODE_ENV: 'test',
      PIGGYVEST_SECRET_KEY: 'legacy-secret',
    })
  ).toEqual(['legacy-secret']);
});

it('falls back to the PVB alias exactly like the shared getter', () => {
  expect(
    collectPiggyvestWebhookSecrets({
      NODE_ENV: 'test',
      PVB_SECRET_KEY: 'alias-secret',
    })
  ).toEqual(['alias-secret']);
});

it('unions current and retained primary keys with the legacy secret', () => {
  mocks.bank.mockReturnValue({
    webhookSecret: 'bank-secret',
    retainedWebhookSecrets: [],
  });
  mocks.custody.mockReturnValue({ webhookSecret: 'custody-secret' });
  mocks.interest.mockReturnValue({
    webhookSecret: 'interest-secret',
    retainedWebhookSecrets: ['retained-secret', 'legacy-secret', '', 42],
  });
  expect(
    collectPiggyvestWebhookSecrets({
      NODE_ENV: 'test',
      PIGGYVEST_SECRET_KEY: 'legacy-secret',
    })
  ).toEqual([
    'legacy-secret',
    'bank-secret',
    'custody-secret',
    'interest-secret',
    'retained-secret',
  ]);
});

it('skips disabled runtimes and tolerates misconfigured ones', () => {
  mocks.bank.mockImplementation(() => {
    throw new Error('misconfigured');
  });
  mocks.interest.mockReturnValue({
    webhookSecret: 'interest-secret',
    retainedWebhookSecrets: ['retained-secret'],
  });
  expect(collectPiggyvestWebhookSecrets({ NODE_ENV: 'test' })).toEqual([
    'interest-secret',
    'retained-secret',
  ]);
});

it('returns no secrets when nothing is configured', () => {
  expect(collectPiggyvestWebhookSecrets({ NODE_ENV: 'test' })).toEqual([]);
});

it('matches the retained key that verifies the delivery', async () => {
  const { createHmac } = await import('node:crypto');
  const rawBody = Buffer.from('{"event":"interest-payout.success"}');
  const signature = createHmac('sha512', 'retained-secret')
    .update(rawBody)
    .digest('hex');
  expect(
    matchPiggyvestWebhookSecret({
      rawBody,
      signature,
      secrets: ['current-secret', 'retained-secret'],
    })
  ).toBe('retained-secret');
  expect(
    matchPiggyvestWebhookSecret({
      rawBody,
      signature: '0'.repeat(128),
      secrets: ['current-secret', 'retained-secret'],
    })
  ).toBeUndefined();
});

it('reports unconfigured when no secret exists anywhere', () => {
  expect(
    verifyPiggyvestWebhookSecrets({
      rawBody: Buffer.from('{}'),
      signature: '0'.repeat(128),
      env: { NODE_ENV: 'test' },
    })
  ).toEqual({ status: 'unconfigured' });
});

it('verifies with a retained key and reports the matched secret', async () => {
  const { createHmac } = await import('node:crypto');
  mocks.interest.mockReturnValue({
    webhookSecret: 'current-secret',
    retainedWebhookSecrets: ['retained-secret'],
  });
  const rawBody = Buffer.from('{"event":"interest-payout.success"}');
  const signature = createHmac('sha512', 'retained-secret')
    .update(rawBody)
    .digest('hex');
  expect(
    verifyPiggyvestWebhookSecrets({
      rawBody,
      signature,
      env: { NODE_ENV: 'test' },
    })
  ).toEqual({ status: 'verified', secret: 'retained-secret' });
  expect(
    verifyPiggyvestWebhookSecrets({
      rawBody,
      signature: '0'.repeat(128),
      env: { NODE_ENV: 'test' },
    })
  ).toEqual({ status: 'invalid' });
});

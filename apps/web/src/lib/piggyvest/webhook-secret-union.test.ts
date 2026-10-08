import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  legacy: vi.fn(),
  bank: vi.fn(),
  custody: vi.fn(),
  interest: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/env', () => ({
  getPiggyvestWebhookSecret: mocks.legacy,
}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxRuntime: mocks.bank,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeRuntime: mocks.custody,
}));
vi.mock(
  '@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime',
  () => ({
    readPrimaryWalletPaidInterestInboxRuntime: mocks.interest,
  })
);

import { collectPiggyvestWebhookSecrets } from './webhook-secret-union';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.legacy.mockReturnValue(undefined);
  mocks.bank.mockReturnValue(null);
  mocks.custody.mockReturnValue(null);
  mocks.interest.mockReturnValue(null);
});

it('returns only the legacy secret when no primary inbox is enabled', () => {
  mocks.legacy.mockReturnValue('legacy-secret');
  expect(collectPiggyvestWebhookSecrets()).toEqual(['legacy-secret']);
});

it('unions current and retained primary keys with the legacy secret', () => {
  mocks.legacy.mockReturnValue('legacy-secret');
  mocks.bank.mockReturnValue({
    webhookSecret: 'bank-secret',
    retainedWebhookSecrets: [],
  });
  mocks.custody.mockReturnValue({ webhookSecret: 'custody-secret' });
  mocks.interest.mockReturnValue({
    webhookSecret: 'interest-secret',
    retainedWebhookSecrets: ['retained-secret', 'legacy-secret', '', 42],
  });
  expect(collectPiggyvestWebhookSecrets()).toEqual([
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
  expect(collectPiggyvestWebhookSecrets()).toEqual([
    'interest-secret',
    'retained-secret',
  ]);
});

it('returns no secrets when nothing is configured', () => {
  expect(collectPiggyvestWebhookSecrets()).toEqual([]);
});

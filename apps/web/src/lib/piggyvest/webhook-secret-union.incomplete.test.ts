import { createHmac } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { testKey } from './webhook-secret-union.test-support';

const INTEREST_SECRET = testKey('interest');

const mocks = vi.hoisted(() => ({
  bank: vi.fn(),
  custody: vi.fn(),
  interest: vi.fn(),
}));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxSecrets: mocks.bank,
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeSecrets: mocks.custody,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxSecrets: mocks.interest,
}));

import { verifyPiggyvestWebhookSecrets } from './webhook-secret-union';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bank.mockReturnValue(null);
  mocks.custody.mockReturnValue(null);
  mocks.interest.mockReturnValue(null);
});

const incompleteBody = new TextEncoder().encode('{"eventId":"evt-incomplete"}');
const signWith = (secret: string) =>
  createHmac('sha512', secret).update(incompleteBody).digest('hex');

it('reports an incomplete key set on a verified delivery when a family failed to load', () => {
  mocks.interest.mockReturnValue({
    webhookSecret: INTEREST_SECRET,
    retainedWebhookSecrets: [],
  });
  mocks.bank.mockImplementation(() => {
    throw new Error('unreadable bank configuration');
  });

  expect(
    verifyPiggyvestWebhookSecrets({
      rawBody: incompleteBody,
      signature: signWith(INTEREST_SECRET),
      env: { NODE_ENV: 'test', PIGGYVEST_SECRET_KEY: 'legacy-secret' },
    })
  ).toMatchObject({
    status: 'verified',
    families: ['interest'],
    incompleteKeySet: true,
  });
});

it('reports an incomplete key set on a verified delivery when the archive is unreadable', () => {
  mocks.interest.mockReturnValue({
    webhookSecret: INTEREST_SECRET,
    retainedWebhookSecrets: [],
  });

  expect(
    verifyPiggyvestWebhookSecrets({
      rawBody: incompleteBody,
      signature: signWith(INTEREST_SECRET),
      env: {
        NODE_ENV: 'test',
        PIGGYVEST_SECRET_KEY: 'legacy-secret',
        PIGGYVEST_WEBHOOK_KEY_ARCHIVE: '{not json',
      },
    })
  ).toMatchObject({ status: 'verified', incompleteKeySet: true });
});

it('does not report an incomplete key set when every family loaded', () => {
  mocks.interest.mockReturnValue({
    webhookSecret: INTEREST_SECRET,
    retainedWebhookSecrets: [],
  });

  expect(
    verifyPiggyvestWebhookSecrets({
      rawBody: incompleteBody,
      signature: signWith(INTEREST_SECRET),
      env: { NODE_ENV: 'test', PIGGYVEST_SECRET_KEY: 'legacy-secret' },
    })
  ).toMatchObject({ status: 'verified', incompleteKeySet: false });
});

import { createHash, createHmac } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';

// Deterministic, distinct signing keys derived from a label, so no signing
// key is a hardcoded literal and every run uses the same inputs.
const testKey = (label: string): string =>
  createHash('sha256')
    .update(`webhook-secret-union-test:${label}`)
    .digest('hex');
const RETAINED_SECRET = testKey('retained');
const UNLOADED_RETAINED_SECRET = testKey('unloaded-retained');
const INTEREST_SECRET = testKey('interest');
const SHARED_SECRET = testKey('shared');

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

import {
  collectPiggyvestWebhookSecrets,
  collectPiggyvestWebhookSecretsWithFamilies,
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
  mocks.custody.mockReturnValue({
    webhookSecret: 'custody-secret',
    retainedWebhookSecrets: ['custody-retained-secret'],
  });
  mocks.interest.mockReturnValue({
    webhookSecret: INTEREST_SECRET,
    retainedWebhookSecrets: [RETAINED_SECRET, 'legacy-secret', '', 42],
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
    'custody-retained-secret',
    INTEREST_SECRET,
    RETAINED_SECRET,
  ]);
});

it('skips disabled runtimes and tolerates misconfigured ones', () => {
  mocks.bank.mockImplementation(() => {
    throw new Error('misconfigured');
  });
  mocks.interest.mockReturnValue({
    webhookSecret: INTEREST_SECRET,
    retainedWebhookSecrets: [RETAINED_SECRET],
  });
  expect(collectPiggyvestWebhookSecrets({ NODE_ENV: 'test' })).toEqual([
    INTEREST_SECRET,
    RETAINED_SECRET,
  ]);
});

it('returns no secrets when nothing is configured', () => {
  expect(collectPiggyvestWebhookSecrets({ NODE_ENV: 'test' })).toEqual([]);
});

it('matches the retained key that verifies the delivery', async () => {
  const { createHmac } = await import('node:crypto');
  const rawBody = Buffer.from('{"event":"interest-payout.success"}');
  const signature = createHmac('sha512', RETAINED_SECRET)
    .update(rawBody)
    .digest('hex');
  expect(
    matchPiggyvestWebhookSecret({
      rawBody,
      signature,
      secrets: ['current-secret', RETAINED_SECRET],
    })
  ).toBe(RETAINED_SECRET);
  expect(
    matchPiggyvestWebhookSecret({
      rawBody,
      signature: '0'.repeat(128),
      secrets: ['current-secret', RETAINED_SECRET],
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
    retainedWebhookSecrets: [RETAINED_SECRET],
  });
  const rawBody = Buffer.from('{"event":"interest-payout.success"}');
  const signature = createHmac('sha512', RETAINED_SECRET)
    .update(rawBody)
    .digest('hex');
  expect(
    verifyPiggyvestWebhookSecrets({
      rawBody,
      signature,
      env: { NODE_ENV: 'test' },
    })
  ).toMatchObject({
    status: 'verified',
    secret: RETAINED_SECRET,
    families: ['interest'],
    keyStatus: 'current',
  });
  expect(
    verifyPiggyvestWebhookSecrets({
      rawBody,
      signature: '0'.repeat(128),
      env: { NODE_ENV: 'test' },
    })
  ).toEqual({ status: 'invalid' });
});

it('reports unconfigured instead of invalid when a family fails to load', async () => {
  const { createHmac } = await import('node:crypto');
  mocks.bank.mockImplementation(() => {
    throw new Error('Primary bank inbox secrets unavailable');
  });
  mocks.interest.mockReturnValue({ webhookSecret: INTEREST_SECRET });
  const rawBody = Buffer.from('{"event":"bank-transfer.inflow.success"}');
  // Signed with a key the failed reader could not load: the key set is
  // incomplete, so the delivery must retry, not 200-ack as invalid.
  const signature = createHmac('sha512', UNLOADED_RETAINED_SECRET)
    .update(rawBody)
    .digest('hex');
  expect(
    verifyPiggyvestWebhookSecrets({
      rawBody,
      signature,
      env: { NODE_ENV: 'test' },
    })
  ).toEqual({ status: 'unconfigured' });
  // A delivery that verifies against a loaded key still flows.
  const valid = createHmac('sha512', INTEREST_SECRET)
    .update(rawBody)
    .digest('hex');
  expect(
    verifyPiggyvestWebhookSecrets({
      rawBody,
      signature: valid,
      env: { NODE_ENV: 'test' },
    }).status
  ).toBe('verified');
});

it('tags each secret with the family that configured it', () => {
  mocks.bank.mockReturnValue({ webhookSecret: 'bank-secret' });
  mocks.custody.mockReturnValue({
    webhookSecret: 'custody-secret',
    retainedWebhookSecrets: ['custody-retained-secret'],
  });
  mocks.interest.mockReturnValue({
    webhookSecret: INTEREST_SECRET,
    retainedWebhookSecrets: [RETAINED_SECRET],
  });
  expect(
    collectPiggyvestWebhookSecretsWithFamilies({
      NODE_ENV: 'test',
      PIGGYVEST_SECRET_KEY: 'legacy-secret',
    })
  ).toEqual([
    { secret: 'legacy-secret', family: 'legacy' },
    { secret: 'bank-secret', family: 'bank' },
    { secret: 'custody-secret', family: 'custody' },
    { secret: 'custody-retained-secret', family: 'custody' },
    { secret: INTEREST_SECRET, family: 'interest' },
    { secret: RETAINED_SECRET, family: 'interest' },
  ]);
});

it('authorizes every family sharing the matched secret value', async () => {
  const { createHmac } = await import('node:crypto');
  mocks.bank.mockReturnValue({ webhookSecret: SHARED_SECRET });
  const rawBody = Buffer.from('{}');
  const signature = createHmac('sha512', SHARED_SECRET)
    .update(rawBody)
    .digest('hex');
  expect(
    verifyPiggyvestWebhookSecrets({
      rawBody,
      signature,
      env: { NODE_ENV: 'test', PIGGYVEST_SECRET_KEY: SHARED_SECRET },
    })
  ).toMatchObject({
    status: 'verified',
    secret: SHARED_SECRET,
    families: ['legacy', 'bank'],
  });
});

it('keeps healthy families when one secrets reader throws', () => {
  mocks.bank.mockImplementation(() => {
    throw new Error('incomplete provisioning');
  });
  mocks.interest.mockReturnValue({ webhookSecret: INTEREST_SECRET });
  expect(
    collectPiggyvestWebhookSecretsWithFamilies({
      NODE_ENV: 'test',
      PIGGYVEST_SECRET_KEY: 'legacy-secret',
    })
  ).toEqual([
    { secret: 'legacy-secret', family: 'legacy' },
    { secret: INTEREST_SECRET, family: 'interest' },
  ]);
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

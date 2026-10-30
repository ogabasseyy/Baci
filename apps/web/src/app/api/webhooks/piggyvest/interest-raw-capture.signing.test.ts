import { createHmac, randomBytes } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { paidInterestFixture as fixture } from '@/lib/piggyvest/primary-wallet-paid-interest.test-support';
import { verifyPiggyvestWebhookSecrets } from '@/lib/piggyvest/webhook-secret-union';
import { captureInterestRawDelivery } from './interest-raw-capture';

const mocks = vi.hoisted(() => ({ enqueue: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-store', () => ({
  createPrimaryWalletPaidInterestInboxStore: () => ({ enqueue: mocks.enqueue }),
}));

// Ephemeral signing material; the monthly payload and assertions stay fixed.
const providerKey = randomBytes(32).toString('hex');
const rawBody = Buffer.from(`  ${JSON.stringify(fixture.event)}\n`);
const signature = createHmac('sha512', providerKey)
  .update(rawBody)
  .digest('hex');

beforeEach(() => {
  vi.clearAllMocks();
  mocks.enqueue.mockResolvedValue('accepted');
  const config = fixture.config;
  const env = {
    VERCEL_ENV: 'production',
    PIGGYVEST_SECRET_KEY: providerKey,
    PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET: providerKey,
    PIGGYVEST_PRIMARY_PAID_INTEREST_RETAINED_WEBHOOK_SECRETS: '[]',
    PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED: 'true',
    PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_DRAIN_SCHEDULED: 'true',
    PIGGYVEST_PRIMARY_INTEGRATION_ID: config.integrationId,
    PIGGYVEST_PRIMARY_ENVIRONMENT: config.environment,
    PIGGYVEST_PRIMARY_PAID_INTEREST_BUSINESS_ID: config.businessId,
    PIGGYVEST_PRIMARY_DB_HOST: config.database.host,
    PIGGYVEST_PRIMARY_DB_PORT: String(config.database.port),
    PIGGYVEST_PRIMARY_DB_NAME: config.database.name,
    PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD: config.database.password,
    PIGGYVEST_PRIMARY_DB_CA: config.database.certificateAuthority,
  };
  for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
});

afterEach(() => vi.unstubAllEnvs());

function verifiedInput() {
  const verification = verifyPiggyvestWebhookSecrets({ rawBody, signature });
  expect(verification.status).toBe('verified');
  if (verification.status !== 'verified') throw new Error('Fixture rejected');
  return { rawBody, signature, families: verification.families };
}

it('captures a shared provider signing key without requiring a separate interest key', async () => {
  const input = verifiedInput();
  expect(input.families).toEqual(['legacy', 'interest']);

  const response = await captureInterestRawDelivery(input);

  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({ interestQueued: true });
  expect(mocks.enqueue).toHaveBeenCalledWith({
    rawHex: rawBody.toString('hex'),
    signature,
  });
});

it('does not acknowledge a legacy-only payout when its durable capture authority is missing', async () => {
  vi.stubEnv('PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET', undefined);
  const input = verifiedInput();
  expect(input.families).toEqual(['legacy']);

  const response = await captureInterestRawDelivery(input);

  expect(response?.status).toBe(503);
  expect(await response?.json()).toEqual({
    received: false,
    code: 'PIGGYVEST_INTEREST_RECONCILIATION_PENDING',
  });
  expect(mocks.enqueue).not.toHaveBeenCalled();
});

it.each([
  'PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED',
  'PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_DRAIN_SCHEDULED',
])('does not acknowledge a shared-key payout without %s', async (flag) => {
  vi.stubEnv(flag, 'false');

  const response = await captureInterestRawDelivery(verifiedInput());

  expect(response?.status).toBe(503);
  expect(mocks.enqueue).not.toHaveBeenCalled();
});

it('cannot acknowledge a shared-key payout before durable storage succeeds', async () => {
  mocks.enqueue.mockRejectedValue(new Error('Fixture storage unavailable'));

  await expect(captureInterestRawDelivery(verifiedInput())).rejects.toThrow(
    'Fixture storage unavailable'
  );
});

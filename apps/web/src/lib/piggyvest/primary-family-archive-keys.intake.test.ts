import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  bankReadiness: vi.fn(),
  bankEnqueue: vi.fn(),
  bankCreate: vi.fn(),
  interestEnqueue: vi.fn(),
  interestCreate: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('./primary-wallet-bank-inbox-store', () => ({
  createPrimaryWalletBankInboxStore: mocks.bankCreate,
}));
vi.mock('./primary-wallet-paid-interest-inbox-store', () => ({
  createPrimaryWalletPaidInterestInboxStore: mocks.interestCreate,
}));

import { primaryBankInboxFixture as bank } from './primary-wallet-bank-inbox.test-fixture';
import { dispatchPrimaryWalletBankInboxIntake } from './primary-wallet-bank-inbox-intake';
import { paidInterestFixture as interest } from './primary-wallet-paid-interest.test-support';
import { dispatchPrimaryWalletPaidInterestInbox } from './primary-wallet-paid-interest-inbox-intake';

const HOUR = 3_600_000;
const iso = (hoursAgo: number) =>
  new Date(Date.now() - hoursAgo * HOUR).toISOString();
const sign = (secret: string, body: Uint8Array) =>
  createHmac('sha512', secret).update(body).digest('hex');

const KEYS = {
  overlap: 'archived-overlap-secret',
  revoked: 'archived-revoked-secret',
  foreign: 'archived-foreign-family-secret',
};
const archive = (family: string, foreign: string) =>
  JSON.stringify([
    { version: 'k-o', family, secret: KEYS.overlap, retiredAt: iso(2) },
    { version: 'k-r', family, secret: KEYS.revoked, retiredAt: iso(200) },
    {
      version: 'k-f',
      family: foreign,
      secret: KEYS.foreign,
      retiredAt: iso(2),
    },
  ]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bankReadiness.mockResolvedValue(true);
  mocks.bankEnqueue.mockResolvedValue('accepted');
  mocks.bankCreate.mockReturnValue({
    readiness: mocks.bankReadiness,
    enqueue: mocks.bankEnqueue,
  });
  mocks.interestEnqueue.mockResolvedValue('accepted');
  mocks.interestCreate.mockReturnValue({ enqueue: mocks.interestEnqueue });
});

describe('bank intake with archived keys', () => {
  const env = {
    ...bank.env,
    PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archive('bank', 'interest'),
  };
  const deliver = (secret: string, keyScope?: 'ingress' | 'replay') =>
    dispatchPrimaryWalletBankInboxIntake({
      rawBody: bank.rawBody,
      signature: sign(secret, bank.rawBody),
      env,
      keyScope,
    });

  it('a bank archived key inside its overlap reaches the bank inbox', async () => {
    const result = await deliver(KEYS.overlap);

    expect(result.outcome).toBe('accepted');
    expect(mocks.bankEnqueue).toHaveBeenCalledWith({
      rawHex: bank.rawBody.toString('hex'),
      signature: sign(KEYS.overlap, bank.rawBody),
    });
  });

  it('a bank archived key past its overlap is refused for a new delivery but replays', async () => {
    const refused = await deliver(KEYS.revoked);
    expect(refused.outcome).toBe('unavailable');
    expect(mocks.bankCreate).not.toHaveBeenCalled();

    const replayed = await deliver(KEYS.revoked, 'replay');
    expect(replayed.outcome).toBe('accepted');
    expect(mocks.bankEnqueue).toHaveBeenCalledTimes(1);
  });

  it('an archived interest key cannot authorise the bank intake, even on replay', async () => {
    for (const keyScope of ['ingress', 'replay'] as const) {
      const result = await deliver(KEYS.foreign, keyScope);
      expect(result.outcome).toBe('unavailable');
    }
    expect(mocks.bankCreate).not.toHaveBeenCalled();
  });

  it('the current key behaves exactly as before', async () => {
    const result = await dispatchPrimaryWalletBankInboxIntake({
      rawBody: bank.rawBody,
      signature: bank.signature,
      env,
    });
    expect(result.outcome).toBe('accepted');
  });
});

describe('interest inbox intake with archived keys', () => {
  const env = {
    NODE_ENV: 'test' as const,
    VERCEL_ENV: 'production',
    PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_ENABLED: 'true',
    PIGGYVEST_PRIMARY_PAID_INTEREST_INBOX_DRAIN_SCHEDULED: 'true',
    PIGGYVEST_PRIMARY_INTEGRATION_ID: interest.config.integrationId,
    PIGGYVEST_PRIMARY_ENVIRONMENT: 'production',
    PIGGYVEST_PRIMARY_PAID_INTEREST_BUSINESS_ID: interest.config.businessId,
    PIGGYVEST_PRIMARY_PAID_INTEREST_WEBHOOK_SECRET:
      interest.config.webhookSecret,
    PIGGYVEST_PRIMARY_DB_HOST: interest.config.database.host,
    PIGGYVEST_PRIMARY_DB_PORT: '5432',
    PIGGYVEST_PRIMARY_DB_NAME: 'postgres',
    PIGGYVEST_PRIMARY_EVIDENCE_DB_PASSWORD: interest.config.database.password,
    PIGGYVEST_PRIMARY_DB_CA: interest.config.database.certificateAuthority,
    PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archive('interest', 'bank'),
  };
  const rawBody = Buffer.from(JSON.stringify(interest.event));
  const deliver = (secret: string, keyScope?: 'ingress' | 'replay') =>
    dispatchPrimaryWalletPaidInterestInbox({
      rawBody,
      signature: sign(secret, rawBody),
      env,
      keyScope,
    });

  it('an interest archived key inside its overlap is queued', async () => {
    await expect(deliver(KEYS.overlap)).resolves.toBe('accepted');
    expect(mocks.interestEnqueue).toHaveBeenCalledTimes(1);
  });

  it('past its overlap it is refused for new deliveries and accepted on replay', async () => {
    await expect(deliver(KEYS.revoked)).resolves.toBe('invalid_signature');
    expect(mocks.interestEnqueue).not.toHaveBeenCalled();
    await expect(deliver(KEYS.revoked, 'replay')).resolves.toBe('accepted');
  });

  it('a bank archived key cannot authorise the interest intake', async () => {
    await expect(deliver(KEYS.foreign, 'replay')).resolves.toBe(
      'invalid_signature'
    );
    expect(mocks.interestEnqueue).not.toHaveBeenCalled();
  });
});

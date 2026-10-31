import { createHmac, randomBytes } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { verifyStoredPiggyvestDelivery } from './verify-stored-piggyvest-delivery';
import { verifyPiggyvestWebhookSecrets } from './webhook-secret-union';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const HOUR = 3_600_000;
const rawBody = new TextEncoder().encode(
  ' {"eventId": "synthetic-rotation"}\n'
);

function ephemeralKey(): string {
  return randomBytes(32).toString('hex');
}

function sign(secret: string, body: Uint8Array = rawBody): string {
  return createHmac('sha512', secret).update(body).digest('hex');
}

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * HOUR).toISOString();
}

function archiveEnv(
  entries: { version: string; family?: string; secret: string; hours: number }[]
): string {
  return JSON.stringify(
    entries.map((entry) => ({
      version: entry.version,
      family: entry.family ?? 'legacy',
      secret: entry.secret,
      retiredAt: hoursAgo(entry.hours),
    }))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.bank.mockReturnValue(null);
  mocks.custody.mockReturnValue(null);
  mocks.interest.mockReturnValue(null);
});

describe('replay never widens the authority recorded at admission', () => {
  // A key that is current only for the interest family, whose legacy
  // assignment (an archived entry for the same secret) has expired.
  function widenedSetup() {
    const shared = ephemeralKey();
    mocks.interest.mockReturnValue({
      webhookSecret: shared,
      retainedWebhookSecrets: [],
    });
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: ephemeralKey(),
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archiveEnv([
        { version: 'legacy-old', family: 'legacy', secret: shared, hours: 200 },
      ]),
    };
    return { shared, env, signature: sign(shared) };
  }

  it('shows why: unrestricted replay verification reports a wider family set than ingress did', () => {
    const { env, signature } = widenedSetup();

    expect(
      verifyPiggyvestWebhookSecrets({ rawBody, signature, env, now: NOW })
    ).toMatchObject({ status: 'verified', families: ['interest'] });
    expect(
      verifyStoredPiggyvestDelivery({ rawBody, signature, env, now: NOW })
    ).toMatchObject({ status: 'verified', families: ['interest', 'legacy'] });
  });

  it('with the recorded families, authority is the intersection and never grows', () => {
    const { env, signature } = widenedSetup();

    expect(
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature,
        env,
        now: NOW,
        recordedFamilies: ['interest'],
      })
    ).toMatchObject({ status: 'verified', families: ['interest'] });
  });

  it('a normal replay within the recorded families keeps all of them', () => {
    const { env, signature } = widenedSetup();

    expect(
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature,
        env,
        now: NOW,
        recordedFamilies: ['interest', 'legacy'],
      })
    ).toMatchObject({ status: 'verified', families: ['interest', 'legacy'] });
  });

  it('reports authority_lost when the key no longer holds any recorded family', () => {
    const { env, signature } = widenedSetup();

    expect(
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature,
        env,
        now: NOW,
        recordedFamilies: ['bank'],
      })
    ).toEqual({ status: 'authority_lost' });
  });
});

describe('an incomplete key set cannot prove that authority was lost', () => {
  // The delivery was admitted as bank-only. Its key is now also configured
  // as the legacy secret, while the archive that holds its bank assignment
  // is either unreadable or intact.
  function bankRecordedSetup(archive: string) {
    const shared = ephemeralKey();
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: shared,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archive,
    };
    return { shared, env, signature: sign(shared) };
  }
  const verify = (setup: ReturnType<typeof bankRecordedSetup>) =>
    verifyStoredPiggyvestDelivery({
      rawBody,
      signature: setup.signature,
      env: setup.env,
      now: NOW,
      recordedFamilies: ['bank'],
    });

  it('is retryable (unconfigured), not authority_lost, while the archive is unreadable', () => {
    const setup = bankRecordedSetup('{not json');

    expect(verify(setup)).toEqual({ status: 'unconfigured' });
  });

  it('keeps authority_lost when the configuration is complete and the intersection is really empty', () => {
    const setup = bankRecordedSetup(
      archiveEnv([
        {
          version: 'bank-other',
          family: 'bank',
          secret: ephemeralKey(),
          hours: 200,
        },
      ])
    );

    expect(verify(setup)).toEqual({ status: 'authority_lost' });
  });

  it('marks a verified replay as incomplete only while part of the key set is unavailable', () => {
    const setup = bankRecordedSetup('{not json');
    const verifyRecorded = (families: ('bank' | 'legacy')[]) =>
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature: setup.signature,
        env: setup.env,
        now: NOW,
        recordedFamilies: families,
      });

    expect(verifyRecorded(['legacy'])).toMatchObject({
      status: 'verified',
      families: ['legacy'],
      incompleteKeySet: true,
    });
    setup.env.PIGGYVEST_WEBHOOK_KEY_ARCHIVE = '[]';
    expect(verifyRecorded(['legacy'])).toMatchObject({
      status: 'verified',
      incompleteKeySet: false,
    });
  });

  it('resumes with the recorded family only once the archive is readable, never the legacy family', () => {
    const { shared } = bankRecordedSetup('[]');
    const setup = bankRecordedSetup(
      archiveEnv([
        { version: 'bank-old', family: 'bank', secret: shared, hours: 200 },
      ])
    );
    setup.env.PIGGYVEST_SECRET_KEY = shared;

    expect(
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature: sign(shared),
        env: setup.env,
        now: NOW,
        recordedFamilies: ['bank'],
      })
    ).toMatchObject({ status: 'verified', families: ['bank'] });
  });
});

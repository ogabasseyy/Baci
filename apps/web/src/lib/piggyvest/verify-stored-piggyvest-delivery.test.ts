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

describe('replay verification of stored requests', () => {
  it('re-verifies a body signed with a revoked archived key without accepting it as new', () => {
    const current = ephemeralKey();
    const old = ephemeralKey();
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archiveEnv([
        { version: 'pv-2026-07', secret: old, hours: 24 * 30 },
      ]),
    };
    const signature = sign(old);

    expect(
      verifyPiggyvestWebhookSecrets({ rawBody, signature, env, now: NOW })
    ).toEqual({ status: 'revoked', keyVersion: 'pv-2026-07' });
    expect(
      verifyStoredPiggyvestDelivery({ rawBody, signature, env, now: NOW })
    ).toMatchObject({
      status: 'verified',
      keyStatus: 'replay-only',
      keyVersion: 'pv-2026-07',
      families: ['legacy'],
    });
  });

  it('re-verifies current and overlap keys and refuses tampered bytes', () => {
    const current = ephemeralKey();
    const env = { NODE_ENV: 'test' as const, PIGGYVEST_SECRET_KEY: current };

    expect(
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature: sign(current),
        env,
        now: NOW,
      })
    ).toMatchObject({ status: 'verified', keyStatus: 'current' });
    expect(
      verifyStoredPiggyvestDelivery({
        rawBody: new TextEncoder().encode('{"eventId":"tampered"}'),
        signature: sign(current),
        env,
        now: NOW,
      })
    ).toEqual({ status: 'unverifiable' });
  });

  it('reports unconfigured when no key at all is available to re-check with', () => {
    expect(
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature: sign(ephemeralKey()),
        env: { NODE_ENV: 'test' as const },
        now: NOW,
      })
    ).toEqual({ status: 'unconfigured' });
  });
});

describe('replay verification across key families and overlap', () => {
  it('re-verifies an overlap key as overlap and reports its family', () => {
    const current = ephemeralKey();
    const overlapKey = ephemeralKey();
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archiveEnv([
        { version: 'pv-bank', family: 'bank', secret: overlapKey, hours: 2 },
      ]),
    };

    expect(
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature: sign(overlapKey),
        env,
        now: NOW,
      })
    ).toMatchObject({
      status: 'verified',
      keyStatus: 'overlap',
      keyVersion: 'pv-bank',
      families: ['bank'],
    });
  });

  it('accepts the canonical signature in any hex case', () => {
    const current = ephemeralKey();
    expect(
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature: sign(current).toUpperCase(),
        env: { NODE_ENV: 'test' as const, PIGGYVEST_SECRET_KEY: current },
        now: NOW,
      }).status
    ).toBe('verified');
  });

  it('is unverifiable for a missing or malformed signature', () => {
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: ephemeralKey(),
    };
    for (const signature of [null, '', 'abc']) {
      expect(
        verifyStoredPiggyvestDelivery({ rawBody, signature, env, now: NOW })
      ).toEqual({ status: 'unverifiable' });
    }
  });
});

describe('replay with an incomplete key set', () => {
  it('reports unconfigured, never unverifiable, when the archive cannot be read', () => {
    const current = ephemeralKey();
    const old = ephemeralKey();
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: '{broken',
    };

    // Signed by a key that only the unreadable archive could contain.
    expect(
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature: sign(old),
        env,
        now: NOW,
      })
    ).toEqual({ status: 'unconfigured' });
    // Bodies a loaded key vouches for still verify.
    expect(
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature: sign(current),
        env,
        now: NOW,
      }).status
    ).toBe('verified');
  });
});

describe('replay of a family archived key past its overlap', () => {
  it('re-verifies a revoked bank key as replay-only for the bank family only', () => {
    const current = ephemeralKey();
    const old = ephemeralKey();
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archiveEnv([
        { version: 'pv-bank', family: 'bank', secret: old, hours: 300 },
      ]),
    };

    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody,
        signature: sign(old),
        env,
        now: NOW,
      })
    ).toEqual({ status: 'revoked', keyVersion: 'pv-bank' });
    expect(
      verifyStoredPiggyvestDelivery({
        rawBody,
        signature: sign(old),
        env,
        now: NOW,
      })
    ).toMatchObject({
      status: 'verified',
      keyStatus: 'replay-only',
      keyVersion: 'pv-bank',
      families: ['bank'],
    });
  });
});

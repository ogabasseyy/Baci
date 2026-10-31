import { createHmac } from 'node:crypto';
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

import { deterministicKeySource } from '@/lib/piggyvest/deterministic-test-data.test-support';
import { verifyPiggyvestWebhookSecrets } from './webhook-secret-union';

const freshKey = deterministicKeySource('webhook-secret-union.rotation');

const NOW = new Date('2026-10-30T12:00:00.000Z');
const HOUR = 3_600_000;
const rawBody = new TextEncoder().encode(
  ' {"eventId": "synthetic-rotation"}\n'
);

function ephemeralKey(): string {
  return freshKey();
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

describe('ingress key classification', () => {
  it('accepts the current key and labels it current with a stable non-secret version', () => {
    const current = ephemeralKey();
    const env = { NODE_ENV: 'test' as const, PIGGYVEST_SECRET_KEY: current };

    const first = verifyPiggyvestWebhookSecrets({
      rawBody,
      signature: sign(current),
      env,
      now: NOW,
    });
    const second = verifyPiggyvestWebhookSecrets({
      rawBody,
      signature: sign(current),
      env,
      now: NOW,
    });

    expect(first).toMatchObject({
      status: 'verified',
      keyStatus: 'current',
      families: ['legacy'],
    });
    const version = first.status === 'verified' ? first.keyVersion : '';
    expect(version).toMatch(/^k-[0-9a-f]{16}$/);
    expect(second).toMatchObject({ keyVersion: version });
    expect(version).not.toContain(current);
  });

  it('keeps accepting a rotated-out key inside the default 72 hour overlap', () => {
    const current = ephemeralKey();
    const old = ephemeralKey();
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archiveEnv([
        { version: 'pv-2026-09', secret: old, hours: 71 },
      ]),
    };

    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody,
        signature: sign(old),
        env,
        now: NOW,
      })
    ).toMatchObject({
      status: 'verified',
      keyStatus: 'overlap',
      keyVersion: 'pv-2026-09',
      families: ['legacy'],
    });
  });

  it('revokes an archived key for new requests once the overlap has elapsed', () => {
    const current = ephemeralKey();
    const old = ephemeralKey();
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archiveEnv([
        { version: 'pv-2026-09', secret: old, hours: 72 },
      ]),
    };

    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody,
        signature: sign(old),
        env,
        now: NOW,
      })
    ).toEqual({ status: 'revoked', keyVersion: 'pv-2026-09' });
    // The current key is unaffected.
    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody,
        signature: sign(current),
        env,
        now: NOW,
      }).status
    ).toBe('verified');
  });

  it('honours a configured overlap and bounds it at seven days', () => {
    const current = ephemeralKey();
    const old = ephemeralKey();
    const base = { NODE_ENV: 'test' as const, PIGGYVEST_SECRET_KEY: current };
    const verify = (hours: number, overlap: string) =>
      verifyPiggyvestWebhookSecrets({
        rawBody,
        signature: sign(old),
        env: {
          ...base,
          PIGGYVEST_WEBHOOK_KEY_OVERLAP_HOURS: overlap,
          PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archiveEnv([
            { version: 'pv-old', secret: old, hours },
          ]),
        },
        now: NOW,
      }).status;

    expect(verify(2, '1')).toBe('revoked');
    expect(verify(2, '3')).toBe('verified');
    expect(verify(200, '100000')).toBe('revoked'); // clamped to 168h
    expect(verify(167, '100000')).toBe('verified');
    expect(verify(73, 'not-a-number')).toBe('revoked'); // falls back to 72h
  });

  it('reports invalid, never revoked, for a signature no configured key made', () => {
    const current = ephemeralKey();
    const stranger = ephemeralKey();
    const env = { NODE_ENV: 'test' as const, PIGGYVEST_SECRET_KEY: current };

    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody,
        signature: sign(stranger),
        env,
        now: NOW,
      })
    ).toEqual({ status: 'invalid' });
  });

  it('reports unconfigured when only archived keys exist', () => {
    const old = ephemeralKey();
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archiveEnv([
        { version: 'pv-old', secret: old, hours: 1 },
      ]),
    };

    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody,
        signature: sign(old),
        env,
        now: NOW,
      })
    ).toEqual({ status: 'unconfigured' });
  });

  it('fails an unmatched delivery as unconfigured (503) when the archive is malformed, but still accepts current keys', () => {
    const current = ephemeralKey();
    const stranger = ephemeralKey();
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: '{not json',
    };

    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody,
        signature: sign(stranger),
        env,
        now: NOW,
      })
    ).toEqual({ status: 'unconfigured' });
    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody,
        signature: sign(current),
        env,
        now: NOW,
      }).status
    ).toBe('verified');
  });

  it('prefers the current classification when an archived entry repeats a current secret', () => {
    const current = ephemeralKey();
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archiveEnv([
        { version: 'pv-dup', secret: current, hours: 500 },
      ]),
    };

    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody,
        signature: sign(current),
        env,
        now: NOW,
      })
    ).toMatchObject({ status: 'verified', keyStatus: 'current' });
  });

  it('routes an overlap key to its configured family only', () => {
    const current = ephemeralKey();
    const old = ephemeralKey();
    const env = {
      NODE_ENV: 'test' as const,
      PIGGYVEST_SECRET_KEY: current,
      PIGGYVEST_WEBHOOK_KEY_ARCHIVE: archiveEnv([
        { version: 'pv-bank', family: 'bank', secret: old, hours: 1 },
      ]),
    };

    expect(
      verifyPiggyvestWebhookSecrets({
        rawBody,
        signature: sign(old),
        env,
        now: NOW,
      })
    ).toMatchObject({ status: 'verified', families: ['bank'] });
  });
});

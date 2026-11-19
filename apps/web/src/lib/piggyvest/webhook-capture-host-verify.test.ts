import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const keys = vi.hoisted(() => ({ bank: '', interest: '' }));
const secrets = (key: string) => (key ? { webhookSecret: key } : null);

vi.mock('server-only', () => ({}));
vi.mock('@/lib/piggyvest/primary-wallet-bank-inbox-runtime', () => ({
  readPrimaryWalletBankInboxSecrets: () => secrets(keys.bank),
}));
vi.mock('@/lib/piggyvest/primary-wallet-card-custody-intake-runtime', () => ({
  readPrimaryCardCustodyIntakeSecrets: () => null,
}));
vi.mock('@/lib/piggyvest/primary-wallet-paid-interest-inbox-runtime', () => ({
  readPrimaryWalletPaidInterestInboxSecrets: () => secrets(keys.interest),
}));

import { deterministicTestKey } from './deterministic-test-data.test-support';
import { verifyOnWorkerHost } from './webhook-capture-host-verify';
import { derivePiggyvestKeyVersion } from './webhook-key-archive';
import type { PiggyvestWebhookKeyFamily } from './webhook-secret-union';

const NOW = new Date('2026-10-30T12:00:00.000Z');
const BODY = '{"eventType":"interest-payout.success"}';
const bankKey = deterministicTestKey('host-verify:bank');
const otherKey = deterministicTestKey('host-verify:other');
const sign = (key: string) =>
  createHmac('sha512', key).update(BODY).digest('hex');

let alerts: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  keys.bank = bankKey;
  keys.interest = '';
  alerts = vi.spyOn(console, 'error').mockImplementation(() => {});
});

function verify(
  signingKey: string,
  recordedFamilies: PiggyvestWebhookKeyFamily[],
  keyVersion = derivePiggyvestKeyVersion(signingKey)
) {
  return verifyOnWorkerHost({
    rawBody: Buffer.from(BODY),
    signature: sign(signingKey),
    recordedFamilies,
    keyVersion,
    captureId: 'capture-under-test',
    env: { NODE_ENV: 'test' },
    now: NOW,
  });
}

describe('verifyOnWorkerHost', () => {
  it('passes a verified row through unchanged when the host holds every recorded family', () => {
    expect(verify(bankKey, ['bank'])).toMatchObject({
      status: 'verified',
      families: ['bank'],
      incompleteKeySet: false,
    });
    expect(alerts).not.toHaveBeenCalled();
  });

  it('defers, with an alert, a row signed by a key version the host does not hold', () => {
    expect(verify(otherKey, ['bank'])).toEqual({ status: 'unconfigured' });
    const [line] = alerts.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(line).toContain('PIGGYVEST_WEBHOOK_KEYS_UNCONFIGURED');
    expect(line).toContain('capture-under-test');
    expect(line).not.toContain(otherKey);
  });

  it('keeps a row unverifiable when the host holds its key version and the signature still fails', () => {
    expect(
      verify(otherKey, ['bank'], derivePiggyvestKeyVersion(bankKey))
    ).toEqual({ status: 'unverifiable' });
  });

  it('marks the key set incomplete when the host lacks a recorded primary family of the matched key', () => {
    // The web app holds the same secret as the bank and interest keys; this
    // host has only loaded it as the bank key. Nothing is granted: the
    // processing families stay bank-only.
    expect(verify(bankKey, ['bank', 'interest'])).toMatchObject({
      status: 'verified',
      families: ['bank'],
      incompleteKeySet: true,
    });
  });

  it('never counts the legacy family, which the worker host holds by design, as missing', () => {
    expect(verify(bankKey, ['bank', 'legacy'])).toMatchObject({
      status: 'verified',
      incompleteKeySet: false,
    });
  });

  it('defers instead of calling authority lost when the recorded family is simply not loaded here', () => {
    expect(verify(bankKey, ['interest'])).toEqual({ status: 'unconfigured' });
  });
});

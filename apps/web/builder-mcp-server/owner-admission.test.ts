import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { createOwnerAdmission } from './owner-admission';

it('admits only a fresh body signed for the exact verifier operation', () => {
  const key = Buffer.alloc(32, 1);
  const body = Buffer.from(
    JSON.stringify({ expiresAt: 1030000, nonce: 'a'.repeat(64) })
  );
  const sign = (prefix: string, bytes = body) =>
    createHmac('sha256', key).update(`${prefix}\n`).update(bytes).digest('hex');
  const admit = createOwnerAdmission(key, 'verifier-attest/v1', () => 1000000);
  expect(admit(body, sign('verifier-attest/v1'))).toBe(true);
  expect(admit(body, sign('verifier-public/v1'))).toBe(false);
  expect(admit(Buffer.from('{}'), sign('verifier-attest/v1'))).toBe(false);
  expect(admit(body, 'a'.repeat(64))).toBe(false);
  const expired = Buffer.from(JSON.stringify({ expiresAt: 999999 }));
  expect(admit(expired, sign('verifier-attest/v1', expired))).toBe(false);
  const farFuture = Buffer.from(JSON.stringify({ expiresAt: 1060001 }));
  expect(admit(farFuture, sign('verifier-attest/v1', farFuture))).toBe(false);
});

it('does not admit the same valid signed nonce twice, but allows fresh nonces after rejection', () => {
  const key = Buffer.alloc(32, 2);
  const admit = createOwnerAdmission(key, 'verifier-attest/v1', () => 1000000);
  const body = Buffer.from(
    JSON.stringify({ expiresAt: 1030000, nonce: 'b'.repeat(64) })
  );
  const signature = createHmac('sha256', key)
    .update('verifier-attest/v1\n')
    .update(body)
    .digest('hex');
  expect(admit(body, 'a'.repeat(64))).toBe(false);
  expect(admit(body, signature)).toBe(true);
  expect(admit(body, signature)).toBe(false);
  const next = Buffer.from(
    JSON.stringify({ expiresAt: 1030000, nonce: 'c'.repeat(64) })
  );
  const nextSignature = createHmac('sha256', key)
    .update('verifier-attest/v1\n')
    .update(next)
    .digest('hex');
  expect(admit(next, nextSignature)).toBe(true);
});

it('bounds the early replay filter and releases entries after expiry', () => {
  const key = Buffer.alloc(32, 3);
  let now = 1000000;
  const admit = createOwnerAdmission(key, 'verifier-attest/v1', () => now);
  const signed = (nonce: string, expiresAt: number) => {
    const body = Buffer.from(JSON.stringify({ nonce, expiresAt }));
    return [
      body,
      createHmac('sha256', key)
        .update('verifier-attest/v1\n')
        .update(body)
        .digest('hex'),
    ] as const;
  };
  for (let i = 0; i < 4096; i++)
    expect(admit(...signed(i.toString(16).padStart(64, '0'), now + 1000))).toBe(
      true
    );
  expect(admit(...signed('f'.repeat(64), now + 1000))).toBe(false);
  now += 1001;
  expect(admit(...signed('f'.repeat(64), now + 1000))).toBe(true);
});

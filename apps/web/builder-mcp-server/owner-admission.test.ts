import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { createOwnerAdmission } from './owner-admission';

function attestation(nonce: string, expiresAt: number) {
  return {
    version: 1,
    nonce,
    expiresAt,
    accessToken: 'synthetic.token',
    approvalId: '11111111-1111-4111-8111-111111111111',
    kind: 'draft',
  };
}

it('admits schema-canonical signatures over reordered wire fields', () => {
  const key = Buffer.alloc(32, 4);
  const domain = 'verifier-attest/v1';
  const canonical = attestation('a'.repeat(64), 1030000);
  const { kind, ...rest } = canonical;
  const wire = Buffer.from(JSON.stringify({ kind, ...rest }, null, 2));
  const sign = (body: string | Buffer) =>
    createHmac('sha256', key).update(`${domain}\n`).update(body).digest('hex');
  const admit = createOwnerAdmission(key, domain, () => 1000000);
  expect(admit(wire, sign(wire))).toBe(false);
  expect(admit(wire, sign(JSON.stringify(canonical)))).toBe(true);
});

it('admits only a fresh body signed for the exact verifier operation', () => {
  const key = Buffer.alloc(32, 1);
  const body = Buffer.from(
    JSON.stringify(attestation('a'.repeat(64), 1030000))
  );
  const sign = (prefix: string, bytes = body) =>
    createHmac('sha256', key).update(`${prefix}\n`).update(bytes).digest('hex');
  const admit = createOwnerAdmission(key, 'verifier-attest/v1', () => 1000000);
  expect(admit(body, sign('verifier-attest/v1'))).toBe(true);
  expect(admit(body, sign('verifier-public/v1'))).toBe(false);
  expect(admit(Buffer.from('{}'), sign('verifier-attest/v1'))).toBe(false);
  expect(admit(body, 'a'.repeat(64))).toBe(false);
  const expired = Buffer.from(
    JSON.stringify(attestation('a'.repeat(64), 999999))
  );
  expect(admit(expired, sign('verifier-attest/v1', expired))).toBe(false);
  const farFuture = Buffer.from(
    JSON.stringify(attestation('a'.repeat(64), 1060001))
  );
  expect(admit(farFuture, sign('verifier-attest/v1', farFuture))).toBe(false);
});

it('does not admit the same valid signed nonce twice, but allows fresh nonces after rejection', () => {
  const key = Buffer.alloc(32, 2);
  const admit = createOwnerAdmission(key, 'verifier-attest/v1', () => 1000000);
  const body = Buffer.from(
    JSON.stringify(attestation('b'.repeat(64), 1030000))
  );
  const signature = createHmac('sha256', key)
    .update('verifier-attest/v1\n')
    .update(body)
    .digest('hex');
  expect(admit(body, 'a'.repeat(64))).toBe(false);
  expect(admit(body, signature)).toBe(true);
  expect(admit(body, signature)).toBe(false);
  const next = Buffer.from(
    JSON.stringify(attestation('c'.repeat(64), 1030000))
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
    const body = Buffer.from(JSON.stringify(attestation(nonce, expiresAt)));
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
  const fresh = signed('f'.repeat(64), now + 1000);
  expect(admit(...fresh)).toBe('busy');
  expect(admit(...signed('0'.repeat(64), now + 1000))).toBe(false);
  expect(admit(fresh[0], 'a'.repeat(64))).toBe(false);
  now += 1001;
  expect(admit(...signed('f'.repeat(64), now + 1000))).toBe(true);
});

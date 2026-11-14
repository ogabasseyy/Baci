import { createHmac } from 'node:crypto';
import { expect, it } from 'vitest';
import { createOwnerAdmission } from './owner-admission';

it('admits only a fresh body signed for the exact verifier operation', () => {
  const key = Buffer.alloc(32, 1);
  const body = Buffer.from(
    JSON.stringify({ expiresAt: 1030000, nonce: 'synthetic' })
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

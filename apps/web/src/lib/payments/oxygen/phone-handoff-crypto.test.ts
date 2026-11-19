import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { decryptPhoneTarget, encryptPhoneTarget } from './phone-handoff-crypto';

const key = 'a'.repeat(64);
const context = {
  hash: 'b'.repeat(64),
  workflowId: '60000000-0000-4000-8000-000000000001',
  applicationReference: '60000000-0000-4000-8000-000000000002',
  environment: 'staging' as const,
};
it('encrypts the signed selfie target and binds it to application, environment and capability', () => {
  const url = 'https://selfie.example.test/?securityToken=private';
  const encrypted = encryptPhoneTarget(url, key, context);
  expect(encrypted).not.toContain('private');
  expect(decryptPhoneTarget(encrypted, key, context)).toBe(url);
  for (const change of [
    { hash: 'c'.repeat(64) },
    { applicationReference: context.workflowId },
    { environment: 'production' as const },
  ])
    expect(() =>
      decryptPhoneTarget(encrypted, key, { ...context, ...change })
    ).toThrow();
});
it('rejects malformed keys and modified ciphertext', () => {
  expect(() =>
    encryptPhoneTarget('https://selfie.example.test', 'bad', context)
  ).toThrow();
  const encrypted = encryptPhoneTarget(
    'https://selfie.example.test',
    key,
    context
  );
  const parts = encrypted.split('.');
  parts[2] = `${parts[2]?.startsWith('A') ? 'B' : 'A'}${parts[2]?.slice(1)}`;
  expect(() => decryptPhoneTarget(parts.join('.'), key, context)).toThrow();
});

afterEach(() => vi.unstubAllEnvs());
it('supports independently keyed v3 alongside old v1 and v2 handoffs', () => {
  const url = 'https://selfie.example.test/?securityToken=private';
  vi.stubEnv('OXYGEN_PURPOSE_KEY_V2_WRITE', '');
  vi.stubEnv('OXYGEN_STAGING_PHONE_KEY_V3_WRITE', '');
  const oldV1 = encryptPhoneTarget(url, key, context);
  vi.stubEnv('OXYGEN_PURPOSE_KEY_V2_WRITE', 'true');
  const oldV2 = encryptPhoneTarget(url, key, context);
  vi.stubEnv('OXYGEN_STAGING_PHONE_HANDOFF_ENCRYPTION_KEY', 'c'.repeat(64));
  vi.stubEnv('OXYGEN_STAGING_PHONE_KEY_V3_WRITE', 'true');
  const next = encryptPhoneTarget(url, key, context);
  expect(next).toMatch(/^v3\./);
  expect(decryptPhoneTarget(next, key, context)).toBe(url);
  expect(decryptPhoneTarget(oldV1, key, context)).toBe(url);
  expect(decryptPhoneTarget(oldV2, key, context)).toBe(url);
  vi.stubEnv('OXYGEN_STAGING_PHONE_KEY_V3_WRITE', '');
  expect(decryptPhoneTarget(next, key, context)).toBe(url);
  vi.stubEnv('OXYGEN_STAGING_PHONE_HANDOFF_ENCRYPTION_KEY', 'd'.repeat(64));
  expect(() => decryptPhoneTarget(next, key, context)).toThrow();
});
it('fails closed for missing or reused independent keys and tampered v3', () => {
  const url = 'https://selfie.example.test/';
  vi.stubEnv('OXYGEN_STAGING_PHONE_KEY_V3_WRITE', 'true');
  vi.stubEnv('OXYGEN_STAGING_PHONE_HANDOFF_ENCRYPTION_KEY', '');
  expect(() => encryptPhoneTarget(url, key, context)).toThrow();
  vi.stubEnv('OXYGEN_STAGING_PHONE_HANDOFF_ENCRYPTION_KEY', 'not-a-key');
  expect(() => encryptPhoneTarget(url, key, context)).toThrow();
  vi.stubEnv('OXYGEN_STAGING_PHONE_HANDOFF_ENCRYPTION_KEY', key.toUpperCase());
  expect(() => encryptPhoneTarget(url, key, context)).toThrow();
  vi.stubEnv('OXYGEN_STAGING_PHONE_HANDOFF_ENCRYPTION_KEY', 'c'.repeat(64));
  const encrypted = encryptPhoneTarget(url, key, context);
  const parts = encrypted.split('.');
  parts[2] = `${parts[2]?.startsWith('A') ? 'B' : 'A'}${parts[2]?.slice(1)}`;
  expect(() => decryptPhoneTarget(parts.join('.'), key, context)).toThrow();
  expect(() =>
    decryptPhoneTarget(encrypted, key, { ...context, hash: 'd'.repeat(64) })
  ).toThrow();
  vi.stubEnv('OXYGEN_PRODUCTION_PHONE_HANDOFF_ENCRYPTION_KEY', 'c'.repeat(64));
  expect(() =>
    decryptPhoneTarget(encrypted, key, {
      ...context,
      environment: 'production',
    })
  ).toThrow();
});

it('uses the independent production key and keeps v3 readable after disabling writes', () => {
  const production = { ...context, environment: 'production' as const };
  const url = 'https://selfie.example.test/';
  vi.stubEnv('OXYGEN_STAGING_PHONE_HANDOFF_ENCRYPTION_KEY', 'c'.repeat(64));
  vi.stubEnv('OXYGEN_PRODUCTION_PHONE_HANDOFF_ENCRYPTION_KEY', 'd'.repeat(64));
  vi.stubEnv('OXYGEN_PRODUCTION_PHONE_KEY_V3_WRITE', 'true');
  const encrypted = encryptPhoneTarget(url, key, production);
  expect(encrypted).toMatch(/^v3\./);
  expect(decryptPhoneTarget(encrypted, key, production)).toBe(url);
  vi.stubEnv('OXYGEN_STAGING_PHONE_HANDOFF_ENCRYPTION_KEY', '');
  expect(decryptPhoneTarget(encrypted, key, production)).toBe(url);
  vi.stubEnv('OXYGEN_PRODUCTION_PHONE_KEY_V3_WRITE', '');
  expect(decryptPhoneTarget(encrypted, key, production)).toBe(url);
});

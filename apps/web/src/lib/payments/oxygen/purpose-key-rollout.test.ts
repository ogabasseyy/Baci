import { createDecipheriv } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { decryptOxygenDraft, encryptOxygenDraft } from './draft-crypto';
import { decryptPhoneTarget, encryptPhoneTarget } from './phone-handoff-crypto';
import { oxygenPurposeKey } from './purpose-key-crypto';

const key = 'ab'.repeat(32);
const draft = { step: 0 as const, fields: { bvn: '12345678901' } };
const context = { userId: 'user', workflowId: 'workflow', version: 1 };
const phone = {
  hash: 'h',
  workflowId: 'workflow',
  applicationReference: 'application',
  environment: 'staging' as const,
};
const url = 'https://selfie.example.test/?token=private';
afterEach(() => vi.unstubAllEnvs());

function oldDraftReader(payload: string) {
  const [version, iv, tag, body] = payload.split('.');
  if (version !== 'v1') throw new Error('Unknown version');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(iv, 'base64url'),
    { authTagLength: 16 }
  );
  cipher.setAAD(
    Buffer.from(
      JSON.stringify([
        'oxygen-form-draft:v1',
        context.userId,
        context.workflowId,
        context.version,
      ])
    )
  );
  cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(body, 'base64url')),
      cipher.final(),
    ]).toString('utf8')
  );
}

function oldPhoneReader(payload: string) {
  const [version, iv, tag, body] = payload.split('.');
  if (version !== 'v1') throw new Error('Unknown version');
  const cipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'hex'),
    Buffer.from(iv, 'base64url'),
    { authTagLength: 16 }
  );
  cipher.setAAD(
    Buffer.from(
      JSON.stringify([
        'oxygen-phone:v1',
        phone.hash,
        phone.workflowId,
        phone.applicationReference,
        phone.environment,
      ])
    )
  );
  cipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return JSON.parse(
    Buffer.concat([
      cipher.update(Buffer.from(body, 'base64url')),
      cipher.final(),
    ]).toString('utf8')
  ).url;
}

it('writes legacy ciphertext by default and reads it on old and new deployments', () => {
  vi.stubEnv('OXYGEN_PURPOSE_KEY_V2_WRITE', '');
  const old = encryptOxygenDraft(draft, key, context);
  const oldPhone = encryptPhoneTarget(url, key, phone);
  expect(old).toMatch(/^v1\./);
  expect(oldPhone).toMatch(/^v1\./);
  expect(oldDraftReader(old)).toEqual(draft);
  expect(oldPhoneReader(oldPhone)).toBe(url);
  expect(decryptOxygenDraft(old, key, context)).toEqual(draft);
  expect(decryptPhoneTarget(oldPhone, key, phone)).toBe(url);
});

it('writes v2 only when explicitly enabled while retaining v1 decryption', () => {
  vi.stubEnv('OXYGEN_PURPOSE_KEY_V2_WRITE', '');
  const old = encryptOxygenDraft(draft, key, context);
  const oldPhone = encryptPhoneTarget(url, key, phone);
  vi.stubEnv('OXYGEN_PURPOSE_KEY_V2_WRITE', 'true');
  const next = encryptOxygenDraft(draft, key, context);
  const nextPhone = encryptPhoneTarget(url, key, phone);
  expect(next).toMatch(/^v2\./);
  expect(nextPhone).toMatch(/^v2\./);
  expect(decryptOxygenDraft(old, key, context)).toEqual(draft);
  expect(decryptOxygenDraft(next, key, context)).toEqual(draft);
  expect(decryptPhoneTarget(oldPhone, key, phone)).toBe(url);
  expect(decryptPhoneTarget(nextPhone, key, phone)).toBe(url);
  expect(() => oldDraftReader(next)).toThrow();
  expect(() => oldPhoneReader(nextPhone)).toThrow();
  vi.stubEnv('OXYGEN_PURPOSE_KEY_V2_WRITE', '');
  expect(decryptOxygenDraft(next, key, context)).toEqual(draft);
  expect(decryptPhoneTarget(nextPhone, key, phone)).toBe(url);
});

it.each([
  '',
  'true',
])('rejects tampering and cross-purpose use for %s writes', (flag) => {
  vi.stubEnv('OXYGEN_PURPOSE_KEY_V2_WRITE', flag);
  const full = encryptOxygenDraft(draft, key, context);
  const residential = encryptOxygenDraft(draft, key, {
    ...context,
    purpose: 'residential',
  });
  const phonePayload = encryptPhoneTarget(url, key, phone);
  expect(() =>
    decryptOxygenDraft(full, key, { ...context, purpose: 'residential' })
  ).toThrow();
  expect(() => decryptOxygenDraft(residential, key, context)).toThrow();
  expect(() => decryptPhoneTarget(full, key, phone)).toThrow();
  expect(() => decryptOxygenDraft(phonePayload, key, context)).toThrow();
  for (const [payload, read] of [
    [full, (v: string) => decryptOxygenDraft(v, key, context)],
    [phonePayload, (v: string) => decryptPhoneTarget(v, key, phone)],
  ] as const) {
    const parts = payload.split('.');
    parts[1] = Buffer.alloc(12).toString('base64url');
    expect(() => read(parts.join('.'))).toThrow();
    const changedVersion = payload.split('.');
    changedVersion[0] = flag ? 'v1' : 'v2';
    expect(() => read(changedVersion.join('.'))).toThrow();
  }
});

it('derives distinct keys for each purpose and never uses the root directly', () => {
  const root = Buffer.from(key, 'hex');
  const derived = (
    ['form-draft', 'residential-draft', 'phone-handoff'] as const
  ).map((purpose) => oxygenPurposeKey(root, purpose).toString('hex'));
  expect(new Set(derived).size).toBe(3);
  expect(derived).not.toContain(key);
});

it.each([
  'TRUE',
  '1',
  'false',
])('does not enable v2 for non-exact flag %s', (flag) => {
  vi.stubEnv('OXYGEN_PURPOSE_KEY_V2_WRITE', flag);
  expect(encryptOxygenDraft(draft, key, context)).toMatch(/^v1\./);
  expect(encryptPhoneTarget(url, key, phone)).toMatch(/^v1\./);
});

import { expect, it, vi } from 'vitest';

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

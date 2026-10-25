import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { decryptOxygenDraft, encryptOxygenDraft } from './draft-crypto';

const key = 'ab'.repeat(32);
const context = { userId: 'user', workflowId: 'workflow', version: 1 };
it('round-trips an encrypted draft without plaintext and binds ciphertext to owner, workflow and revision', () => {
  const draft = { step: 0 as const, fields: { bvn: '12345678901' } };
  const encrypted = encryptOxygenDraft(draft, key, context);
  expect(encrypted).not.toContain('12345678901');
  expect(encryptOxygenDraft(draft, key, context)).not.toBe(encrypted);
  expect(decryptOxygenDraft(encrypted, key, context)).toEqual(draft);
  expect(() =>
    decryptOxygenDraft(encrypted, key, { ...context, userId: 'another' })
  ).toThrow();
  expect(() =>
    decryptOxygenDraft(encrypted, key, { ...context, workflowId: 'other' })
  ).toThrow();
  expect(() =>
    decryptOxygenDraft(encrypted, key, { ...context, version: 2 })
  ).toThrow();
  expect(() =>
    decryptOxygenDraft(encrypted, 'cd'.repeat(32), context)
  ).toThrow();
});
it('fails closed without a dedicated key and rejects tampered ciphertext', () => {
  expect(() =>
    encryptOxygenDraft({ step: 0, fields: {} }, '', context)
  ).toThrow();
  const encrypted = encryptOxygenDraft({ step: 0, fields: {} }, key, context);
  expect(() =>
    decryptOxygenDraft(`${encrypted}tampered`, key, context)
  ).toThrow();
});

import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { acceptJobOutput, signJobTicket } from './output-receiver';
import { createTransientOutputStore } from './transient-output-store';

const t = {
  jobId: 'job',
  sourceDigest: 'a'.repeat(64),
  attemptNonce: 'attempt',
  audience: 'experience-output' as const,
  toolchainDigest: 'b'.repeat(64),
  expiresAt: 2000,
  maxBytes: 1024,
};
it('accepts signed current attempt only; expires after24h without touching durable data', async () => {
  const key = randomBytes(32);
  const store = createTransientOutputStore();
  const signed = signJobTicket(t, key);
  const result = await acceptJobOutput(
    signed,
    { javascript: 'x', css: '' },
    { key, store, now: () => 1000, currentAttempt: async () => t.attemptNonce }
  );
  expect(store.read(result, 1001)).toEqual({ javascript: 'x', css: '' });
  store.sweep(86401001);
  expect(() => store.read(result, 86401001)).toThrow();
  await expect(
    acceptJobOutput(
      { ...signed, ticket: { ...t, sourceDigest: 'c'.repeat(64) } },
      {},
      {
        key,
        store,
        now: () => 1000,
        currentAttempt: async () => t.attemptNonce,
      }
    )
  ).rejects.toThrow('INVALID_REQUEST');
  await expect(
    acceptJobOutput(
      signed,
      {},
      { key, store, now: () => 1000, currentAttempt: async () => 'retry' }
    )
  ).rejects.toThrow('INVALID_REQUEST');
  await expect(
    acceptJobOutput(
      signed,
      {},
      {
        key,
        store,
        now: () => 2000,
        currentAttempt: async () => t.attemptNonce,
      }
    )
  ).rejects.toThrow('INVALID_REQUEST');
});

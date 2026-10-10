import { expect, it } from 'vitest';
import { replaySignatureLookupSchema } from './replay-signature-reader';

const scope = {
  receiptId: '10000000-0000-4000-8000-000000000001',
  payloadSha256: 'a'.repeat(64),
  claimToken: '20000000-0000-4000-8000-000000000001',
};

it('accepts the exact UUID lease and payload digest without changing values', () => {
  expect(replaySignatureLookupSchema.parse(scope)).toEqual(scope);
});

it.each([
  { field: 'receiptId', value: '' },
  { field: 'receiptId', value: 'receipt-001' },
  { field: 'claimToken', value: 'token' },
  { field: 'claimToken', value: null },
  { field: 'payloadSha256', value: 'a'.repeat(63) },
  { field: 'payloadSha256', value: `${'a'.repeat(64)}\n` },
  { field: 'payloadSha256', value: 'G'.repeat(64) },
])('refuses malformed $field before a scoped read', ({ field, value }) => {
  const result = replaySignatureLookupSchema.safeParse({
    ...scope,
    [field]: value,
  });
  expect(result.success).toBe(false);
  if (!result.success) expect(result.error.issues[0].path).toEqual([field]);
});

it('rejects extra authority supplied by a caller', () => {
  expect(
    replaySignatureLookupSchema.safeParse({ ...scope, role: 'service_role' })
      .success
  ).toBe(false);
});

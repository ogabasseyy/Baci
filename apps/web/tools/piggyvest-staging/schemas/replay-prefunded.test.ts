import { expect, it } from 'vitest';
import { replayPrefundedSchemas as schemas } from './replay-prefunded';

it('requires an explicit trusted enrollment disposition', () => {
  for (const status of ['enrolled', 'legacy', 'deferred'])
    expect(schemas.enrollment.parse(status)).toBe(status);
  for (const status of [undefined, null, false, 'unknown'])
    expect(schemas.enrollment.safeParse(status).success).toBe(false);
});

it('preserves a missing signature without manufacturing one', () => {
  expect(schemas.originalSignature.parse(null)).toBeNull();
});

it.each([
  { receiptId: '' },
  { payloadSha256: 'wrong-digest' },
  { signature: 'a'.repeat(127) },
  { signature: `${'a'.repeat(128)}\n` },
  { signature: null },
])('refuses incomplete original signature provenance: %j', (change) => {
  expect(
    schemas.originalSignature.safeParse({
      receiptId: 'receipt',
      payloadSha256: 'b'.repeat(64),
      signature: 'a'.repeat(128),
      ...change,
    }).success
  ).toBe(false);
});

it('preserves original signature casing exactly', () => {
  expect(
    schemas.originalSignature.parse({
      receiptId: 'receipt',
      payloadSha256: 'b'.repeat(64),
      signature: 'A'.repeat(128),
    })?.signature
  ).toBe('A'.repeat(128));
});

it.each([
  { outcome: 'processed' },
  { outcome: 'processed', projection: 'deferred' },
  { outcome: 'retry' },
  { outcome: 'deferred' },
  { outcome: 'processed', projection: 'applied', fallback: true },
])('refuses ambiguous replay acknowledgement %j', (result) => {
  expect(schemas.outcome.safeParse(result).success).toBe(false);
});

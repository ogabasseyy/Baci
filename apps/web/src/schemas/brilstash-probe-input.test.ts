import { expect, it } from 'vitest';
import { brilStashProbeInputSchema } from './brilstash-probe-input';

const input = {
  installationId: '30000000-0000-4000-8000-000000000001',
  expectedGenerationId: '70000000-0000-4000-8000-000000000001',
  expectedPayloadDigest: 'a'.repeat(64),
};

it('accepts explicitly pinned probe inputs', () => {
  expect(brilStashProbeInputSchema.parse(input)).toEqual(input);
  expect(
    brilStashProbeInputSchema.parse({ ...input, minPrice: 250_000 })
  ).toEqual({ ...input, minPrice: 250_000 });
});

it.each([
  { installationId: 'bad' },
  { expectedGenerationId: 'bad' },
  { expectedPayloadDigest: 'a'.repeat(63) },
  { expectedPayloadDigest: 'A'.repeat(64) },
  { minPrice: 250_001 },
  { extra: true },
])('rejects invalid probe bindings %#', (override) => {
  expect(
    brilStashProbeInputSchema.safeParse({ ...input, ...override }).success
  ).toBe(false);
});

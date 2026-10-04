import { expect, it } from 'vitest';
import { deviceChangeFixture } from '../test-fixtures/piggyvest-device-change';
import { piggyvestDeviceChangeSchemas as schemas } from './piggyvest-device-change';

it('accepts exact documented local shape but never client pricing or actor authority', () => {
  const fixture = deviceChangeFixture();
  expect(schemas.selection.safeParse(fixture.selection).success).toBe(true);
  for (const extra of [
    { priceKobo: 1 },
    { actorId: fixture.command.goalId },
    { durationMonths: 6 },
  ])
    expect(
      schemas.selection.safeParse({ ...fixture.selection, ...extra }).success
    ).toBe(false);
  expect(
    schemas.published.safeParse({
      ...fixture.published,
      terms: { ...fixture.published.terms, hash: 'a'.repeat(64) },
    }).success
  ).toBe(false);
});
it('rejects malformed or oversized UTF8 terms without native-only string APIs', () => {
  const terms = deviceChangeFixture().published.terms;
  for (const text of ['\ud800', '😀'.repeat(8193), '   '])
    expect(schemas.terms.safeParse({ ...terms, text }).success).toBe(false);
  expect(
    schemas.terms.safeParse({ ...terms, text: '😀'.repeat(8192) }).success
  ).toBe(true);
});

import { expect, it } from 'vitest';
import { brilStashInstallationPriceSchema } from './brilstash-installation-price';

it.each([0, 250_000])('accepts the installation handoff price %d', (price) => {
  const input = { handoffMinPrice: price };
  expect(brilStashInstallationPriceSchema.parse(input)).toEqual(input);
});

it.each([
  -1,
  1,
  249_999,
  250_001,
  250_000.5,
  '250000',
  null,
  undefined,
  true,
])('rejects invalid installation handoff price %s', (price) => {
  expect(
    brilStashInstallationPriceSchema.safeParse({ handoffMinPrice: price })
      .success
  ).toBe(false);
});

it('accepts the handoff price alongside other installation metadata', () => {
  expect(
    brilStashInstallationPriceSchema.parse({
      handoffMinPrice: 250_000,
      admission: 'open',
    })
  ).toEqual({ handoffMinPrice: 250_000 });
});

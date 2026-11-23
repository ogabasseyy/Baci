import { expect, it } from 'vitest';
import { partialRefundDatabaseUrlSchema } from './bank-offer-partial-refund-database-url';

it.each(['postgresql', 'postgres'])('accepts a %s database URL', (protocol) => {
  expect(
    partialRefundDatabaseUrlSchema.safeParse(
      `${protocol}://db.example.test/postgres`
    ).success
  ).toBe(true);
});

it('rejects missing or non-PostgreSQL URLs', () => {
  expect(partialRefundDatabaseUrlSchema.safeParse(undefined).success).toBe(
    false
  );
  expect(
    partialRefundDatabaseUrlSchema.safeParse('https://db.example.test/postgres')
      .success
  ).toBe(false);
});

import { describe, expect, it } from 'vitest';
import { piggyvestPrimaryWalletReviewSchemas as schemas } from './piggyvest-primary-wallet-review';

describe('primary wallet review database response boundary', () => {
  it.each([
    'routing',
    'ownership',
    null,
  ])('accepts the stored reason %s', (reason) => {
    expect(schemas.reason.parse(reason)).toBe(reason);
    expect(schemas.rows.parse([{ result: reason }])).toEqual([
      { result: reason },
    ]);
  });

  it.each([
    undefined,
    'pending',
    {},
    1,
  ])('rejects an unsupported reason %s', (reason) => {
    expect(schemas.reason.safeParse(reason).success).toBe(false);
    expect(schemas.rows.safeParse([{ result: reason }]).success).toBe(false);
  });

  it.each([
    [],
    [{ result: null }, { result: 'ownership' }],
    [{}],
    [{ result: null, walletId: 'unexpected' }],
  ])('rejects missing, ambiguous or overbroad database rows %j', (rows) => {
    expect(schemas.rows.safeParse(rows).success).toBe(false);
  });
});

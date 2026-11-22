import { describe, expect, it } from 'vitest';
import { piggyvestLegacyMigratedWalletRowsSchema as schema } from './piggyvest-legacy-migrated-wallets';

const walletId = (index: number) =>
  `0b3f1e0a-0000-4000-8000-${String(index).padStart(12, '0')}`;
const rows = (result: unknown) => [{ result }];
const valid = {
  count: 2,
  totalBalance: '1750.50',
  wallets: [
    { walletId: walletId(1), balance: '1250.50' },
    { walletId: walletId(2), balance: '500.00' },
  ],
};

describe('piggyvestLegacyMigratedWalletRowsSchema', () => {
  it('accepts a consistent answer', () => {
    expect(schema.parse(rows(valid))[0].result).toEqual(valid);
  });

  it('accepts nothing flagged', () => {
    expect(
      schema.safeParse(rows({ count: 0, totalBalance: '0.00', wallets: [] }))
        .success
    ).toBe(true);
  });

  it('accepts a count above the 50 listed wallets and a very large total', () => {
    const wallets = Array.from({ length: 50 }, (_, index) => ({
      walletId: walletId(index),
      balance: '99999999.99',
    }));
    expect(
      schema.safeParse(
        rows({ count: 75, totalBalance: '123456789012345678.00', wallets })
      ).success
    ).toBe(true);
  });

  it.each([
    ['no rows', []],
    ['two rows', [{ result: valid }, { result: valid }]],
    ['a negative count', rows({ ...valid, count: -1 })],
    ['a fractional count', rows({ ...valid, count: 1.5 })],
    ['a count below the listed wallets', rows({ ...valid, count: 1 })],
    ['a count above a short list', rows({ ...valid, count: 3 })],
    [
      'a count above 50 with fewer than 50 listed',
      rows({
        count: 75,
        totalBalance: '75.00',
        wallets: Array.from({ length: 49 }, (_, index) => ({
          walletId: walletId(index),
          balance: '1.00',
        })),
      }),
    ],
    [
      'a count with no wallet ids',
      rows({ count: 1, totalBalance: '1.00', wallets: [] }),
    ],
    ['a total without kobo', rows({ ...valid, totalBalance: '1750' })],
    ['a total with three decimals', rows({ ...valid, totalBalance: '1.005' })],
    ['a negative total', rows({ ...valid, totalBalance: '-1.00' })],
    ['a numeric total', rows({ ...valid, totalBalance: 1750.5 })],
    [
      'a wallet balance without kobo',
      rows({
        ...valid,
        wallets: [valid.wallets[0], { walletId: walletId(2), balance: '500' }],
      }),
    ],
    [
      'a wallet id that is not a uuid',
      rows({
        ...valid,
        wallets: [valid.wallets[0], { walletId: 'x', balance: '500.00' }],
      }),
    ],
    [
      'more than 50 wallets',
      rows({
        count: 51,
        totalBalance: '51.00',
        wallets: Array.from({ length: 51 }, (_, index) => ({
          walletId: walletId(index),
          balance: '1.00',
        })),
      }),
    ],
    ['an extra result key', rows({ ...valid, names: [] })],
    [
      'an extra wallet key',
      rows({
        ...valid,
        wallets: [
          valid.wallets[0],
          { ...valid.wallets[1], email: 'customer@example.test' },
        ],
      }),
    ],
    ['an extra row key', [{ result: valid, extra: true }]],
  ])('rejects %s (reported unreadable, never clear)', (_label, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });
});

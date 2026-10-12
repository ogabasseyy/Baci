import { describe, expect, it } from 'vitest';
import { isPiggyvestTransactionListRequestPath } from './transaction-list-request-path';

const prefix = '/api/v1/transaction?wallet_id=wallet&limit=20&collapse_batch=0';
describe('transaction list request path', () => {
  it('requires independent canonical wallet validation', () => {
    expect(isPiggyvestTransactionListRequestPath(prefix, () => false)).toBe(
      false
    );
    expect(isPiggyvestTransactionListRequestPath(prefix, () => true)).toBe(
      true
    );
  });
  it('accepts canonical opaque cursor encoding', () => {
    expect(
      isPiggyvestTransactionListRequestPath(
        `${prefix}&cursor=%252F+%2B%2F`,
        () => true
      )
    ).toBe(true);
  });
  it.each([
    '/api/v1/transaction',
    '/api/v1/transactions?wallet_id=wallet&limit=20&collapse_batch=0',
    '/api/v1/transaction?limit=20&collapse_batch=0',
    '/api/v1/transaction?wallet_id=wallet&limit=20&collapse_batch=1',
    '/api/v1/transaction?wallet_id=wallet&limit=020&collapse_batch=0',
    `${prefix}&wallet_id=other`,
    `${prefix}&limit=1`,
    `${prefix}&cursor=x&cursor=y`,
    `${prefix}&get_batch_info=1`,
    `${prefix}#fragment`,
    `${prefix}&cursor=%0a`,
    `${prefix}&cursor=${'x'.repeat(513)}`,
    `${prefix}&cursor=x%20y`,
  ])('rejects broader or ambiguous path %s', (path) => {
    expect(isPiggyvestTransactionListRequestPath(path, () => true)).toBe(false);
  });
});

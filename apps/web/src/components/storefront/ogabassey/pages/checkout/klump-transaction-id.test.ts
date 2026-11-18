import { describe, expect, it } from 'vitest';
import { getKlumpTransactionId } from './klump-transaction-id';

describe('getKlumpTransactionId', () => {
  it('reads the first present transaction id key, trimmed', () => {
    const params = new URLSearchParams({
      transaction_id: '  txn-2 ',
      klump_transaction_id: ' txn-1 ',
    });

    expect(getKlumpTransactionId(params)).toBe('txn-1');
  });

  it('falls back to later aliases', () => {
    expect(getKlumpTransactionId(new URLSearchParams({ tx_ref: 'ref-9' }))).toBe(
      'ref-9'
    );
  });

  it('returns null when no key has a value', () => {
    expect(
      getKlumpTransactionId(new URLSearchParams({ id: '   ', other: 'x' }))
    ).toBeNull();
  });
});

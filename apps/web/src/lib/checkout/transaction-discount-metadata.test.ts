import { describe, expect, it } from 'vitest';
import { TRANSACTION_DISCOUNT_METADATA_KEY } from './transaction-discount-metadata';

describe('transaction discount metadata', () => {
  it('uses a namespaced key that cannot collide with ad attribution fields', () => {
    expect(TRANSACTION_DISCOUNT_METADATA_KEY).toBe('baci_transaction_discount');
  });
});

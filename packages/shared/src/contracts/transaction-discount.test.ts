import { describe, expect, it } from 'vitest';
import { TRANSACTION_DISCOUNT_METADATA_KEY } from './transaction-discount';

describe('transaction discount metadata contract', () => {
  it('keeps the persisted metadata key stable', () => {
    expect(TRANSACTION_DISCOUNT_METADATA_KEY).toBe('baci_transaction_discount');
  });
});

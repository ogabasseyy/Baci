import { describe, expect, it } from '@jest/globals';
import {
  STORE_CREDIT_ROW_LIMIT,
  WALLET_TRANSACTION_FETCH_LIMIT,
} from './wallet-transaction-limits';

describe('wallet transaction limits', () => {
  it('reads more legacy rows than it shows', () => {
    expect(STORE_CREDIT_ROW_LIMIT).toBe(20);
    expect(WALLET_TRANSACTION_FETCH_LIMIT).toBeGreaterThan(
      STORE_CREDIT_ROW_LIMIT
    );
  });
});

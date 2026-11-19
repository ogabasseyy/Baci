import { describe, expectTypeOf, it } from 'vitest';
import type { PendingTransactionMockOptions } from './vtu-fulfillment.test-support-types';

describe('PendingTransactionMockOptions', () => {
  it('requires a transaction row and keeps every other option optional', () => {
    expectTypeOf<{
      transactionRow: Record<string, unknown>;
    }>().toMatchTypeOf<PendingTransactionMockOptions>();
    expectTypeOf<
      PendingTransactionMockOptions['updatePayloads']
    >().toEqualTypeOf<unknown[] | undefined>();
  });
});

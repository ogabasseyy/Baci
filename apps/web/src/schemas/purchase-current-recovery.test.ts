import { describe, expect, it } from 'vitest';
import { purchaseCurrentRecoverySchemas } from './purchase-current-recovery';

describe('purchaseCurrentRecoverySchemas', () => {
  it('requires exactly one result row', () => {
    expect(purchaseCurrentRecoverySchemas.rows.safeParse([]).success).toBe(
      false
    );
    expect(
      purchaseCurrentRecoverySchemas.rows.safeParse([{ result: null }]).success
    ).toBe(false);
  });

  it('rejects a non-object result', () => {
    expect(
      purchaseCurrentRecoverySchemas.rows.safeParse([{ result: 42 }]).success
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { cancellationRecoveryRowsSchema } from './cancellation-recovery';

describe('cancellationRecoveryRowsSchema', () => {
  it('requires exactly one row', () => {
    expect(cancellationRecoveryRowsSchema.safeParse([]).success).toBe(false);
    expect(
      cancellationRecoveryRowsSchema.safeParse([
        { result: null },
        { result: null },
      ]).success
    ).toBe(false);
  });

  it('rejects a non-object result', () => {
    expect(
      cancellationRecoveryRowsSchema.safeParse([{ result: null }]).success
    ).toBe(false);
    expect(
      cancellationRecoveryRowsSchema.safeParse([{ result: 42 }]).success
    ).toBe(false);
  });
});

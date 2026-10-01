import { describe, expect, it } from 'vitest';
import { discoveryBackfillSchema } from './discovery-backfill';

const merchantId = '11111111-1111-4111-8111-111111111111';

describe('discoveryBackfillSchema', () => {
  it('accepts a scoped first page and UUID cursor', () => {
    expect(
      discoveryBackfillSchema.safeParse({ merchantId, cursor: null }).success
    ).toBe(true);
    expect(
      discoveryBackfillSchema.safeParse({ merchantId, cursor: merchantId })
        .success
    ).toBe(true);
  });

  it('rejects extra fields, malformed IDs, and missing cursors', () => {
    expect(
      discoveryBackfillSchema.safeParse({
        merchantId,
        cursor: null,
        geminiKey: 'x',
      }).success
    ).toBe(false);
    expect(
      discoveryBackfillSchema.safeParse({ merchantId: 'other', cursor: null })
        .success
    ).toBe(false);
    expect(discoveryBackfillSchema.safeParse({ merchantId }).success).toBe(
      false
    );
  });
});

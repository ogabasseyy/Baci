import { describe, expect, it } from 'vitest';
import {
  ADMIN_OPERATIONS_MAX_OFFSET,
  adminOperationsQuerySchema,
} from './admin-operations-query';

describe('adminOperationsQuerySchema', () => {
  it('uses bounded defaults for the all-sections read model', () => {
    expect(adminOperationsQuerySchema.parse({})).toEqual({
      limit: 25,
      offset: 0,
      section: 'all',
    });
  });

  it('rejects unbounded, unsupported, and unknown query inputs', () => {
    expect(adminOperationsQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false
    );
    expect(adminOperationsQuerySchema.safeParse({ offset: -1 }).success).toBe(
      false
    );
    expect(
      adminOperationsQuerySchema.safeParse({
        offset: ADMIN_OPERATIONS_MAX_OFFSET + 1,
      }).success
    ).toBe(false);
    expect(
      adminOperationsQuerySchema.safeParse({ section: 'retry-all' }).success
    ).toBe(false);
    expect(
      adminOperationsQuerySchema.safeParse({ unexpected: 'value' }).success
    ).toBe(false);
  });
});

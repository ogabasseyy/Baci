import { describe, expect, it } from 'vitest';
import {
  adminPlatformAccessRevokeSchema,
  adminPlatformAccessUpsertSchema,
} from './admin-platform-access';

describe('admin platform access schemas', () => {
  it('normalizes a confirmed membership update with a bounded reason', () => {
    expect(
      adminPlatformAccessUpsertSchema.parse({
        confirmed: true,
        email: '  OWNER@EXAMPLE.TEST ',
        reason: '  Add finance operator for month-end reconciliation. ',
        role: 'finance',
      })
    ).toMatchObject({
      email: 'owner@example.test',
      reactivate: false,
      role: 'finance',
    });
  });

  it('requires an explicit confirmation and a non-empty reason before revocation', () => {
    expect(
      adminPlatformAccessRevokeSchema.safeParse({
        confirmed: false,
        email: 'operator@example.test',
        reason: '',
      }).success
    ).toBe(false);
  });
});

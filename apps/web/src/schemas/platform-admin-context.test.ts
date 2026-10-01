import { describe, expect, it } from 'vitest';
import { platformAdminContextRpcSchema } from './platform-admin-context';

describe('platform admin context RPC schema', () => {
  it('accepts the minimal role and permission DTO', () => {
    expect(
      platformAdminContextRpcSchema.safeParse([
        {
          role: 'operations',
          permissions: ['platform.read', 'operations.manage'],
        },
      ]).success
    ).toBe(true);
  });

  it('fails closed for unknown permissions and duplicate context rows', () => {
    expect(
      platformAdminContextRpcSchema.safeParse([
        { role: 'viewer', permissions: ['merchant.delete'] },
      ]).success
    ).toBe(false);
    expect(
      platformAdminContextRpcSchema.safeParse([
        { role: 'viewer', permissions: ['platform.read'] },
        { role: 'viewer', permissions: ['platform.read'] },
      ]).success
    ).toBe(false);
  });
});

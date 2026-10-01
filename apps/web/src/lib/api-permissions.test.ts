import { describe, expect, it } from 'vitest';
import { hasPermission } from './api-permissions';

describe('hasPermission', () => {
  it('grants owners and applies explicit staff grants without loading server auth infrastructure', () => {
    expect(
      hasPermission(
        {
          isOwner: true,
          isStaff: false,
          merchantId: 'merchant-1',
          permissions: {},
          role: 'owner',
        },
        'builder',
        'edit'
      )
    ).toBe(true);
    expect(
      hasPermission(
        {
          isOwner: false,
          isStaff: true,
          merchantId: 'merchant-1',
          permissions: { builder: { edit: true } },
          role: 'editor',
        },
        'builder',
        'edit'
      )
    ).toBe(true);
  });
});

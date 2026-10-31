import { describe, expect, it } from 'vitest';
import {
  PermissionBooleanSchema,
  parseStaffPermissionGrants,
  resolveStaffPermissionGrant,
} from './staff-permission-grants';

describe('PermissionBooleanSchema', () => {
  it.each([
    [true, true],
    ['yes', true],
    ['T', true],
    [1, true],
    [false, false],
    ['off', false],
    [0, false],
  ])('reads %j as %s', (value, expected) => {
    expect(PermissionBooleanSchema.parse(value)).toBe(expected);
  });

  it.each([2, 'maybe', null, {}])('rejects %j', (value) => {
    expect(PermissionBooleanSchema.safeParse(value).success).toBe(false);
  });
});

describe('parseStaffPermissionGrants', () => {
  it('keeps only the listed resources and recognisable booleans', () => {
    expect(
      parseStaffPermissionGrants(
        {
          orders: { fulfill: 'true', edit: 'sometimes', view: 1 },
          products: { edit: true },
          full_access: 'all',
          '*': {},
        },
        ['*', 'full_access', 'orders']
      )
    ).toEqual({ orders: { fulfill: true, view: true } });
  });
});

describe('resolveStaffPermissionGrant', () => {
  it('returns false when no grant applies', () => {
    expect(resolveStaffPermissionGrant({}, 'orders', 'fulfill')).toBe(false);
  });

  it.each([
    [{ '*': { '*': true } }],
    [{ '*': { fulfill: true } }],
    [{ orders: { '*': true } }],
    [{ orders: { fulfill: true } }],
    [{ orders: { all: true } }],
    [{ full_access: { all: true } }],
  ])('allows the action from %j', (permissions) => {
    expect(resolveStaffPermissionGrant(permissions, 'orders', 'fulfill')).toBe(
      true
    );
  });

  it('lets the first defined grant win, like the database check', () => {
    expect(
      resolveStaffPermissionGrant(
        { orders: { '*': false, fulfill: true } },
        'orders',
        'fulfill'
      )
    ).toBe(false);
    expect(
      resolveStaffPermissionGrant(
        { orders: { fulfill: false }, full_access: { all: true } },
        'orders',
        'fulfill'
      )
    ).toBe(false);
  });
});

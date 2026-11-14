import { describe, expect, it } from 'vitest';
import {
  canBookOrderGigl,
  OrderFulfillAccessRowSchema,
  resolveOrderFulfillAccess,
} from './order-fulfill-access';

const merchantId = '97e7a9a4-4f82-484d-a0a5-0f2ba07f4e2e';

function staffRow(permissions: Record<string, unknown>) {
  return OrderFulfillAccessRowSchema.parse({
    is_owner: false,
    is_staff: true,
    merchant_id: merchantId,
    permissions,
    role: 'fulfillment',
  });
}

describe('OrderFulfillAccessRowSchema', () => {
  it('keeps order grants and drops other resources', () => {
    const row = staffRow({
      orders: { fulfill: true, edit: 'false' },
      products: { edit: true },
    });

    expect(row.permissions).toEqual({
      orders: { fulfill: true, edit: false },
    });
  });

  it('rejects a row without a merchant id', () => {
    expect(
      OrderFulfillAccessRowSchema.safeParse({
        is_owner: false,
        is_staff: true,
        merchant_id: 'not-a-uuid',
        permissions: {},
        role: 'staff',
      }).success
    ).toBe(false);
  });
});

describe('resolveOrderFulfillAccess', () => {
  it('lets the owner fulfil and edit whatever the permissions say', () => {
    const row = OrderFulfillAccessRowSchema.parse({
      is_owner: true,
      is_staff: false,
      merchant_id: merchantId,
      permissions: {},
      role: 'owner',
    });

    expect(resolveOrderFulfillAccess(row)).toEqual({
      canFulfill: true,
      canEdit: true,
    });
  });

  it('gives the default fulfillment role the price but not booking', () => {
    const access = resolveOrderFulfillAccess(
      staffRow({ orders: { view: true, fulfill: true } })
    );

    expect(access).toEqual({ canFulfill: true, canEdit: false });
    expect(canBookOrderGigl(access)).toBe(false);
  });

  it('lets staff with orders.fulfill and orders.edit book GIG', () => {
    const access = resolveOrderFulfillAccess(
      staffRow({ orders: { fulfill: true, edit: true } })
    );

    expect(access).toEqual({ canFulfill: true, canEdit: true });
    expect(canBookOrderGigl(access)).toBe(true);
  });

  it('denies staff without orders.fulfill even when they can edit orders', () => {
    const access = resolveOrderFulfillAccess(
      staffRow({ orders: { edit: true } })
    );

    expect(access).toEqual({ canFulfill: false, canEdit: true });
    expect(canBookOrderGigl(access)).toBe(false);
  });

  it('honours wildcard and full-access grants', () => {
    expect(resolveOrderFulfillAccess(staffRow({ '*': { '*': true } }))).toEqual(
      { canFulfill: true, canEdit: true }
    );
    expect(
      resolveOrderFulfillAccess(staffRow({ full_access: { all: true } }))
    ).toEqual({ canFulfill: true, canEdit: true });
  });

  it('keeps an explicit orders.fulfill false ahead of full access', () => {
    expect(
      resolveOrderFulfillAccess(
        staffRow({ orders: { fulfill: false }, full_access: { all: true } })
      )
    ).toEqual({ canFulfill: false, canEdit: true });
  });
});

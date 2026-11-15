import { z } from 'zod';
import {
  parseStaffPermissionGrants,
  resolveStaffPermissionGrant,
} from './staff-permission-grants';

/** What the signed-in user may do when shipping an order. */
export interface OrderFulfillAccess {
  /** orders.fulfill: see the GIG price, wallet balance and funding account. */
  canFulfill: boolean;
  /** orders.edit: change the order, which binding and booking GIG need. */
  canEdit: boolean;
}

export const deniedOrderFulfillAccess: OrderFulfillAccess = {
  canFulfill: false,
  canEdit: false,
};

export const ownerOrderFulfillAccess: OrderFulfillAccess = {
  canFulfill: true,
  canEdit: true,
};

const ORDER_PERMISSION_RESOURCES = ['*', 'full_access', 'orders'] as const;

/** One row of the get_user_access RPC, keeping only order grants. */
export const OrderFulfillAccessRowSchema = z
  .object({
    merchant_id: z.uuid(),
    is_owner: z.boolean(),
    is_staff: z.boolean(),
    role: z.string(),
    permissions: z.record(z.string(), z.unknown()),
  })
  .transform((row) => ({
    ...row,
    permissions: parseStaffPermissionGrants(
      row.permissions,
      ORDER_PERMISSION_RESOURCES
    ),
  }));

export type OrderFulfillAccessRow = z.infer<typeof OrderFulfillAccessRowSchema>;

/**
 * The owner always passes; staff resolve each grant the way the database
 * check does (public.check_staff_permission), which is the final gate.
 */
export function resolveOrderFulfillAccess(
  row: OrderFulfillAccessRow
): OrderFulfillAccess {
  if (row.is_owner) return ownerOrderFulfillAccess;
  return {
    canFulfill: resolveStaffPermissionGrant(
      row.permissions,
      'orders',
      'fulfill'
    ),
    canEdit: resolveStaffPermissionGrant(row.permissions, 'orders', 'edit'),
  };
}

/**
 * Binding a GIG quote, booking it from the merchant wallet and recovering a
 * checkout GIG destination all rewrite the order, so the server requires both
 * orders.fulfill and orders.edit for them.
 */
export function canBookOrderGigl(access: OrderFulfillAccess): boolean {
  return access.canFulfill && access.canEdit;
}

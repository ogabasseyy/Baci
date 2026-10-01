import type { SupabaseClient } from '@supabase/supabase-js';
import type { StaffAccess, StaffRole } from '@/hooks/use-merchant';
import type { UserAccess } from '@/lib/api-permissions';
import { mergeStaffPermissions } from '@/lib/staff-permissions-merge';

export type MerchantContext = NonNullable<
  Awaited<ReturnType<typeof getMerchantForApiRequest>>
>;

/**
 * Convert getMerchantForApiRequest result to UserAccess for use with hasPermission().
 * This avoids an extra RPC call when the route already resolved the merchant.
 */
export function toUserAccess(ctx: MerchantContext): UserAccess {
  return {
    merchantId: ctx.merchantId,
    role: ctx.staffAccess.role || 'owner',
    isOwner: ctx.staffAccess.isOwner,
    isStaff: ctx.staffAccess.isStaff,
    permissions: ctx.staffAccess.permissions,
  };
}

/**
 * Resolves merchant context for API requests, supporting both merchant owners and staff members.
 *
 * This follows the same pattern as getMerchantForUser in merchant-server.ts, but without
 * React cache() since API routes don't benefit from request-level caching the same way.
 *
 * @param supabase - The Supabase client (already authenticated)
 * @param userId - The authenticated user's ID
 * @returns Merchant ID and staff access info, or null if no merchant found
 */
export async function getMerchantForApiRequest(
  supabase: SupabaseClient,
  userId: string,
  options: {
    requestedMerchantId?: string | null;
  } = {}
): Promise<{
  merchantId: string;
  merchantSlug?: string;
  businessName?: string;
  staffAccess: StaffAccess;
} | null> {
  const requestedMerchantId = options.requestedMerchantId?.trim() || null;

  // First, try to find merchant where user is owner
  let ownerQuery = supabase
    .from('merchants')
    .select('id, slug, business_name')
    .eq('user_id', userId);

  if (requestedMerchantId) {
    ownerQuery = ownerQuery.eq('id', requestedMerchantId);
  } else {
    ownerQuery = ownerQuery
      .or('business_name.not.is.null,slug.not.is.null')
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(1);
  }

  const { data: ownedMerchant, error: ownerError } =
    await ownerQuery.maybeSingle();

  if (ownedMerchant && !ownerError) {
    return {
      merchantId: ownedMerchant.id,
      merchantSlug: ownedMerchant.slug,
      businessName: ownedMerchant.business_name,
      staffAccess: {
        isStaff: false,
        isOwner: true,
        role: null,
        permissions: { full_access: { all: true } },
      },
    };
  }

  // User is not a merchant owner (or has an incomplete merchant), check if they're staff
  let staffQuery = supabase
    .from('staff_members')
    .select(
      `
      id,
      role,
      permissions,
      status,
      merchant_id,
      merchants (id, slug, business_name)
    `
    )
    .eq('user_id', userId)
    .eq('status', 'active');

  if (requestedMerchantId) {
    staffQuery = staffQuery.eq('merchant_id', requestedMerchantId).limit(1);
  } else {
    staffQuery = staffQuery
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .limit(1);
  }

  const { data: staffMember, error: staffError } =
    await staffQuery.maybeSingle();

  if (staffMember && !staffError && staffMember.merchants) {
    // Handle join result (could be array or object depending on Supabase version)
    const merchantInfo = Array.isArray(staffMember.merchants)
      ? staffMember.merchants[0]
      : staffMember.merchants;

    if (merchantInfo) {
      // Get role-based permissions
      const { data: rolePerms } = await supabase
        .from('role_permissions')
        .select('permissions')
        .eq('role', staffMember.role)
        .single();

      const defaultPerms = (rolePerms?.permissions || {}) as Record<
        string,
        Record<string, boolean>
      >;
      const customPerms = (staffMember.permissions || {}) as Record<
        string,
        Record<string, boolean>
      >;

      // Per-resource deep merge: custom actions override, default siblings kept.
      // Mirrors the get_staff_permissions / get_user_access RPCs.
      const mergedPermissions = mergeStaffPermissions(
        defaultPerms,
        customPerms
      );

      return {
        merchantId: merchantInfo.id,
        merchantSlug: merchantInfo.slug,
        businessName: merchantInfo.business_name,
        staffAccess: {
          isStaff: true,
          isOwner: false,
          role: staffMember.role as StaffRole,
          permissions: mergedPermissions,
        },
      };
    }
  }

  // No merchant found for this user
  return null;
}

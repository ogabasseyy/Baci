import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  AdminPlatformAccessMembership,
  AdminPlatformAccessUpsert,
} from '@/schemas/admin-platform-access';
import { adminPlatformAccessMembershipListSchema } from '@/schemas/admin-platform-access';
import type { Database } from '@/types/supabase';

interface PlatformAccessRpcResult {
  data: unknown;
  error: { code?: string; message: string } | null;
}

type PlatformAccessReadRpc = (args: {
  p_limit: number;
  p_offset?: number;
}) => Promise<PlatformAccessRpcResult>;

type PlatformAccessUpsertRpc = (args: {
  p_confirmed: boolean;
  p_email: string;
  p_reactivate: boolean;
  p_reason: string;
  p_role: AdminPlatformAccessUpsert['role'];
}) => Promise<PlatformAccessRpcResult>;

type PlatformAccessRevokeRpc = (args: {
  p_confirmed: boolean;
  p_email: string;
  p_reason: string;
}) => Promise<PlatformAccessRpcResult>;

export interface AdminPlatformAccessError {
  code?: string;
  message: string;
}

interface PlatformAccessRpc {
  (
    functionName: 'list_platform_admin_memberships_v1',
    args: Parameters<PlatformAccessReadRpc>[0]
  ): ReturnType<PlatformAccessReadRpc>;
  (
    functionName: 'revoke_platform_admin_membership_v1',
    args: Parameters<PlatformAccessRevokeRpc>[0]
  ): ReturnType<PlatformAccessRevokeRpc>;
  (
    functionName: 'upsert_platform_admin_membership_v1',
    args: Parameters<PlatformAccessUpsertRpc>[0]
  ): ReturnType<PlatformAccessUpsertRpc>;
}

function accessRpc(client: SupabaseClient<Database>): PlatformAccessRpc {
  return client.rpc as unknown as PlatformAccessRpc;
}

function parseMemberships(result: PlatformAccessRpcResult): {
  data: AdminPlatformAccessMembership[] | null;
  error: AdminPlatformAccessError | null;
} {
  if (result.error) {
    return { data: null, error: result.error };
  }

  const parsed = adminPlatformAccessMembershipListSchema.safeParse(result.data);
  if (!parsed.success) {
    return {
      data: null,
      error: {
        code: 'INVALID_PLATFORM_ACCESS_PAYLOAD',
        message: 'Platform access RPC returned an invalid payload',
      },
    };
  }

  return { data: parsed.data, error: null };
}

export async function listAdminPlatformAccess(
  supabase: SupabaseClient<Database>,
  limit = 100,
  offset = 0
) {
  return parseMemberships(
    await accessRpc(supabase)('list_platform_admin_memberships_v1', {
      p_limit: limit,
      p_offset: offset,
    })
  );
}

export async function upsertAdminPlatformAccess(
  supabase: SupabaseClient<Database>,
  input: AdminPlatformAccessUpsert
) {
  return parseMemberships(
    await accessRpc(supabase)('upsert_platform_admin_membership_v1', {
      p_confirmed: input.confirmed,
      p_email: input.email,
      p_reactivate: input.reactivate,
      p_reason: input.reason,
      p_role: input.role,
    })
  );
}

export async function revokeAdminPlatformAccess(
  supabase: SupabaseClient<Database>,
  input: { confirmed: true; email: string; reason: string }
) {
  return parseMemberships(
    await accessRpc(supabase)('revoke_platform_admin_membership_v1', {
      p_confirmed: input.confirmed,
      p_email: input.email,
      p_reason: input.reason,
    })
  );
}

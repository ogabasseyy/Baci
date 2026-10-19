import { unstable_rethrow } from 'next/navigation';
import type { PlatformAdminPermission } from '@/config/platform-admin-rbac';
import { createClient } from '@/lib/supabase/server';
import {
  type PlatformAdminContext,
  platformAdminContextRpcSchema,
} from '@/schemas/platform-admin-context';

type PlatformAdminUser = { email: string | null; id: string };

export type PlatformAdminAuth =
  | { status: 'authenticated'; user: PlatformAdminUser }
  | { status: 'forbidden' }
  | { status: 'unauthenticated' };

export type PlatformAdminContextAuth =
  | {
      context: PlatformAdminContext;
      status: 'authenticated';
      user: PlatformAdminUser;
    }
  | { status: 'forbidden' }
  | { status: 'unauthenticated' };

export async function getPlatformAdminContextAuth(): Promise<PlatformAdminContextAuth> {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return { status: 'unauthenticated' };
    }

    const rpcResult = await supabase.rpc('get_platform_admin_context_v1');
    if (rpcResult.error) {
      return { status: 'forbidden' };
    }

    const parsed = platformAdminContextRpcSchema.safeParse(rpcResult.data);
    const context = parsed.success ? parsed.data[0] : undefined;
    if (!context) {
      return { status: 'forbidden' };
    }

    return {
      context,
      status: 'authenticated',
      user: {
        email: user.email ?? null,
        id: user.id,
      },
    };
  } catch (error) {
    unstable_rethrow(error);
    console.error('[platform-admin-auth] authorization lookup failed');
    return { status: 'unauthenticated' };
  }
}

/**
 * Compatibility guard for existing admin routes and layouts. New routes should
 * prefer getPlatformAdminAuthForPermission() to keep authorization explicit.
 */
export async function getPlatformAdminAuth(): Promise<PlatformAdminAuth> {
  const auth = await getPlatformAdminContextAuth();

  if (auth.status !== 'authenticated') {
    return auth;
  }

  return {
    status: 'authenticated',
    user: auth.user,
  };
}

/**
 * Named permission boundary for new platform-admin routes. Permissions are
 * resolved live by PostgreSQL, never inferred from merchant ownership or staff.
 */
export async function getPlatformAdminAuthForPermission(
  permission: PlatformAdminPermission
): Promise<PlatformAdminContextAuth> {
  const auth = await getPlatformAdminContextAuth();

  if (auth.status !== 'authenticated') {
    return auth;
  }

  if (!auth.context.permissions.includes(permission)) {
    return { status: 'forbidden' };
  }

  return auth;
}

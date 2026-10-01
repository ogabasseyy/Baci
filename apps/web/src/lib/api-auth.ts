/**
 * API Route Authentication Helper
 * Supports both Bearer token auth (mobile apps) and cookie-based auth (web).
 * - Bearer tokens: Verified with an anon-scoped client (no service role).
 * - Cookies: Verified via the server factory (cookie forwarding).
 * After verification, use the returned supabase client for RLS-safe queries.
 */

import type { SupabaseClient, User } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import type { UserAccess } from '@/lib/api-permissions';
import { createAnonClient } from '@/lib/supabase/anon';
import { createScopedClient } from '@/lib/supabase/scoped';
import { createClient } from '@/lib/supabase/server';
import { userAccessSchema } from '@/schemas/api-auth';

function _createScopedClient(token: string): SupabaseClient {
  return createScopedClient(token);
}

export interface AuthResult {
  user: User | null;
  error: string | null;
  supabase: SupabaseClient | null;
}

export function hasBearerAuthScheme(request: Request | NextRequest): boolean {
  const authHeader = request.headers.get('Authorization') ?? '';
  return /^\s*bearer(?:\s|$)/i.test(authHeader);
}

export function getBearerTokenFromRequest(
  request: Request | NextRequest
): string | null {
  const authHeader = request.headers.get('Authorization') ?? '';
  const match = authHeader.match(/^\s*bearer\s+(.+?)\s*$/i);
  const token = match?.[1]?.trim();
  return token || null;
}

/**
 * Authenticate an API request from either mobile (Bearer token) or web (cookies).
 * Returns the authenticated user on success, or an error message on failure.
 *
 * @param request - The NextRequest object
 * @returns AuthResult with user or error
 */
export async function authenticateApiRequest(
  request: Request | NextRequest
): Promise<AuthResult> {
  // Check for Bearer token first (mobile app)
  const token = getBearerTokenFromRequest(request);
  if (token) {
    const anonClient = createAnonClient();

    // Verify the token using an anon-scoped client (no service role)
    const {
      data: { user },
      error,
    } = await anonClient.auth.getUser(token);

    if (error || !user) {
      return { user: null, error: 'Invalid or expired token', supabase: null };
    }

    return { user, error: null, supabase: _createScopedClient(token) };
  }

  // Fallback to cookie-based auth (web)
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (error || !user) {
      return { user: null, error: 'Not authenticated', supabase: null };
    }

    return { user, error: null, supabase };
  } catch {
    return { user: null, error: 'Authentication failed', supabase: null };
  }
}

/**
 * Get the merchant ID for an authenticated API user.
 * Supports both merchant owners and staff members.
 *
 * @param supabase - Scoped Supabase client (RLS enforced)
 * @returns The merchant ID if found, null otherwise
 */
export async function getMerchantIdForApiUser(
  supabase: SupabaseClient
): Promise<string | null> {
  const access = await getUserAccess(supabase);
  return access?.merchantId ?? null;
}

export type { UserAccess } from '@/lib/api-permissions';

/**
 * User access information for API authorization.
 * 2026 Best Practice: Use unified access pattern instead of separate owner/staff checks.
 */
export { hasPermission } from '@/lib/api-permissions';

/**
 * Get full access information for an authenticated API user.
 * Returns role, permissions, and flags for authorization decisions.
 *
 * @param supabase - Scoped Supabase client (RLS enforced)
 * @returns UserAccess object if authorized, null otherwise
 */
export async function getUserAccess(
  supabase: SupabaseClient
): Promise<UserAccess | null> {
  const { data, error } = await supabase.rpc('get_user_access');
  if (error) {
    console.error('getUserAccess RPC error:', error.message, error.code);
    return null;
  }
  if (!data) return null;

  const access = Array.isArray(data) ? data[0] : data;
  if (!access) return null;

  const parsed = userAccessSchema.safeParse(access);
  if (!parsed.success) {
    console.error(
      'getUserAccess schema validation failed:',
      parsed.error.flatten()
    );
    return null;
  }

  return {
    merchantId: parsed.data.merchant_id,
    role: parsed.data.role,
    isOwner: parsed.data.is_owner,
    isStaff: parsed.data.is_staff,
    permissions: parsed.data.permissions ?? {},
  };
}

/**
 * Check if a user has a specific permission.
 *
 * @param access - UserAccess object
 * @param resource - Resource name (e.g., 'orders', 'products')
 * @param action - Action name (e.g., 'read', 'write', 'delete')
 * @returns true if user has permission
 */

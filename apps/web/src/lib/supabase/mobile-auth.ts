import { createServerClient } from '@supabase/ssr';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { getSupabaseAuthRuntimeConfig } from './supabase-auth-runtime-config';

/**
 * Get the authenticated user from either:
 * 1. Bearer token in Authorization header (mobile apps, API clients)
 * 2. Cookie-based auth (web browser)
 *
 * 2025 Best Practice:
 * - Use `getUser()` to validate JWTs server-side (prevents spoofing)
 * - Never trust `getSession()` alone for auth verification
 * - Create a properly scoped client for subsequent queries
 */
export async function getAuthenticatedUser(request: Request) {
  const { anonKey, url } = getSupabaseAuthRuntimeConfig();

  // Check for Bearer token from Authorization header (mobile/API)
  const authHeader = request.headers.get('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const accessToken = authHeader.slice(7);

    const supabase = createSupabaseClient(url, anonKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (!error && user) {
      return { authMode: 'bearer' as const, user, supabase };
    }
  }

  // Fall back to cookie-based auth (web browser)
  try {
    const cookieStore = await cookies();
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value;
        },
      },
    });

    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    if (!error && user) {
      return { authMode: 'cookie' as const, user, supabase };
    }
  } catch {
    // Cookie access may fail in certain contexts
  }

  return null;
}

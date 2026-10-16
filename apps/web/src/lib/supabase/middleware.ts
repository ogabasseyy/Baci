import { type CookieOptions, createServerClient } from '@supabase/ssr';
import { type NextRequest, NextResponse } from 'next/server';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/env';

/**
 * Creates a Supabase client for use in Next.js middleware.
 * This handles session refresh and cookie management automatically.
 *
 * @see https://supabase.com/docs/guides/auth/server-side
 */
export async function updateSession(
  request: NextRequest,
  response?: NextResponse
) {
  // Create a response that we can modify, or use the provided one
  let supabaseResponse =
    response ??
    NextResponse.next({
      request,
    });

  const supabase = createServerClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    cookieOptions: {
      sameSite: 'lax',
      secure: true,
    },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(
        cookiesToSet: { name: string; value: string; options: CookieOptions }[]
      ) {
        // Set cookies on the request for downstream middleware/handlers
        for (const { name, value } of cookiesToSet) {
          // RequestCookies updates the incoming Cookie header; browser cookie
          // attributes are applied separately on the response below.
          request.cookies.set({ name, value });
        }
        // Create a new response with updated request AND PRESERVE HEADERS
        // We use request.headers to ensure headers like x-nonce are passed along
        supabaseResponse = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });
        // Set cookies on the response for the browser
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: Do not run code between createServerClient and supabase.auth.getUser()
  // A simple mistake could make your app vulnerable to session replay attacks.

  // This will refresh the session if expired
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabaseResponse, user };
}

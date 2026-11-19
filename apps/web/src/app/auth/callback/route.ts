import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { CUSTOMER_SESSION_HINT_COOKIE } from '@/contexts/customer-session-hint';
import { normalizeAuthNextTarget } from '@/lib/auth-redirect';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams, origin, protocol } = new URL(request.url);
  const code = searchParams.get('code');
  // if "next" is in param, use it as the redirect URL
  const next = normalizeAuthNextTarget(searchParams.get('next'), origin);

  if (code) {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      response.cookies.set(CUSTOMER_SESSION_HINT_COOKIE, '', {
        path: '/',
        maxAge: 0,
        sameSite: 'lax',
        secure: protocol === 'https:',
      });
      return response;
    }
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(
    `${origin}/login?error=Could not authenticate user`
  );
}

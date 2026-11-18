import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CUSTOMER_SESSION_HINT_COOKIE } from '@/contexts/customer-session-hint';
import { normalizeAuthNextTarget } from '@/lib/auth-redirect';
import { createClient } from '@/lib/supabase/server';

function buildConfirmationErrorRedirect(
  origin: string,
  message: string,
  requestHeaders: Headers,
  next: string
): string {
  // Storefront customers must land on the storefront login (where they can
  // request a fresh code), not the merchant/admin `/login`. Two storefront
  // shapes reach here:
  //  - own-origin confirms (custom domain): flagged by the proxy headers →
  //    `/account/login` on that origin.
  //  - root-domain confirms: kept on the platform host with a slug-prefixed
  //    `next` (e.g. `/ogabassey/account/...`) → derive `/{slug}/account/login`.
  const slugMatch = next.match(/^\/([^/]+)\/account(?:\/|$)/);
  const isStorefrontDomainConfirm = Boolean(
    requestHeaders.get('x-custom-domain') ||
      requestHeaders.get('x-merchant-domain')
  );

  let loginPath = '/login';
  if (slugMatch) {
    loginPath = `/${slugMatch[1]}/account/login`;
  } else if (isStorefrontDomainConfirm) {
    loginPath = '/account/login';
  }
  return `${origin}${loginPath}?error=${encodeURIComponent(message)}`;
}

const confirmEmailSchema = z.object({
  token_hash: z.string().trim().min(1),
  type: z.enum([
    'signup',
    'invite',
    'magiclink',
    'recovery',
    'email_change',
    'email',
  ]),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestHeaders = await headers();
  const isStorefrontDomainConfirm = Boolean(
    requestHeaders.get('x-custom-domain') ||
      requestHeaders.get('x-merchant-domain')
  );
  // On a storefront's own (custom) domain, the platform default `/dashboard`
  // is storefront content, not the customer account area, so an empty/sanitized
  // `next` would land the customer on a broken page. Default those confirms to
  // the customer account area instead.
  const next = normalizeAuthNextTarget(
    url.searchParams.get('next'),
    url.origin,
    isStorefrontDomainConfirm ? '/account' : undefined
  );
  const parsed = confirmEmailSchema.safeParse({
    token_hash: url.searchParams.get('token_hash'),
    type: url.searchParams.get('type'),
  });

  if (!parsed.success) {
    return NextResponse.redirect(
      buildConfirmationErrorRedirect(
        url.origin,
        'Invalid confirmation link',
        requestHeaders,
        next
      )
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const { error } = await supabase.auth.verifyOtp(parsed.data);

  if (error) {
    return NextResponse.redirect(
      buildConfirmationErrorRedirect(
        url.origin,
        error.message || 'Could not authenticate user',
        requestHeaders,
        next
      )
    );
  }

  const response = NextResponse.redirect(
    next.startsWith('baciadmin://') ? next : `${url.origin}${next}`
  );
  response.cookies.set(CUSTOMER_SESSION_HINT_COOKIE, '', {
    path: '/',
    maxAge: 0,
    sameSite: 'lax',
    secure: url.protocol === 'https:',
  });
  return response;
}

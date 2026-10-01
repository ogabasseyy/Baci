import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import {
  type getJumiaAuthUrl,
  isJumiaAuthUrlVariant,
} from '@/lib/jumia/helpers';
import { jumiaOAuthDiagnostic } from '@/lib/jumia/oauth-diagnostic';
import { logger } from '@/lib/logger';
import { getPlatformAdminAuth } from '@/lib/platform-admin-auth';

type JumiaAuthUrlVariant = NonNullable<
  Parameters<typeof getJumiaAuthUrl>[0]['variant']
>;

type InitiationContext =
  | { ok: false; response: NextResponse }
  | {
      ok: true;
      diagnosticRequested: boolean;
      platform: string | null;
      variant: JumiaAuthUrlVariant | undefined;
    };

function getPreAuthResponse(
  searchParams: URLSearchParams
): NextResponse | null {
  if (
    jumiaOAuthDiagnostic.isRequested(searchParams) &&
    searchParams.get('platform') === 'mobile'
  ) {
    return NextResponse.json(
      { error: 'Jumia OAuth diagnostic is not available on mobile' },
      { status: 400 }
    );
  }

  return null;
}

async function getContext({
  apiUserId,
  searchParams,
}: {
  apiUserId: string;
  searchParams: URLSearchParams;
}): Promise<InitiationContext> {
  const diagnosticRequested = jumiaOAuthDiagnostic.isRequested(searchParams);
  const platform = searchParams.get('platform');
  const rawVariant = searchParams.get('variant');
  const variant = isJumiaAuthUrlVariant(rawVariant) ? rawVariant : undefined;

  const preAuthResponse = getPreAuthResponse(searchParams);
  if (preAuthResponse) {
    return {
      ok: false,
      response: preAuthResponse,
    };
  }

  if (!diagnosticRequested && variant === 'F') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Jumia OAuth variant F is diagnostic-only' },
        { status: 400 }
      ),
    };
  }

  if (diagnosticRequested) {
    const platformAdminAuth = await getPlatformAdminAuth();
    if (
      platformAdminAuth.status !== 'authenticated' ||
      platformAdminAuth.user.id !== apiUserId
    ) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: 'Jumia OAuth diagnostic is restricted' },
          { status: 403 }
        ),
      };
    }
  }

  return {
    diagnosticRequested,
    ok: true,
    platform,
    variant,
  };
}

function applyResponse({
  diagnosticRequested,
  merchantId,
  platform,
  redirectUrl,
  response,
  state,
  variant,
}: {
  diagnosticRequested: boolean;
  merchantId: string;
  platform: string | null;
  redirectUrl: string;
  response: NextResponse;
  state: string;
  variant?: JumiaAuthUrlVariant;
}): void {
  const cookieOptions = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 10,
  };
  response.cookies.set('jumia_oauth_state', state, cookieOptions);
  response.cookies.set('jumia_merchant_id', merchantId, cookieOptions);

  if (variant) {
    response.cookies.set('jumia_oauth_variant', variant, cookieOptions);
  } else {
    response.cookies.delete('jumia_oauth_variant');
  }

  if (platform) {
    response.cookies.set('jumia_oauth_platform', platform, cookieOptions);
  } else {
    response.cookies.delete('jumia_oauth_platform');
  }

  if (!diagnosticRequested) {
    response.cookies.delete(jumiaOAuthDiagnostic.cookieName);
    return;
  }

  response.headers.set('Cache-Control', 'private, no-store');

  const diagnosticId = crypto.randomUUID();
  response.cookies.set(
    jumiaOAuthDiagnostic.cookieName,
    diagnosticId,
    cookieOptions
  );
  logger.info({
    message: '[Jumia OAuth Diagnostic] Authorization started',
    diagnostic_id: diagnosticId,
    variant: variant ?? 'default',
    ...jumiaOAuthDiagnostic.getAuthorizationEvidence(redirectUrl),
  });
}

export const jumiaOAuthInitiationDiagnostic = {
  applyResponse,
  getContext,
  getPreAuthResponse,
};

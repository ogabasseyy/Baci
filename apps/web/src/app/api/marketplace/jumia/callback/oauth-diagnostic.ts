import type { NextResponse } from 'next/server';
import {
  exchangeJumiaCode,
  sanitizeJumiaErrorDetails,
} from '@/lib/jumia/helpers';
import { jumiaOAuthDiagnostic } from '@/lib/jumia/oauth-diagnostic';
import { logger } from '@/lib/logger';
import { getPlatformAdminAuth } from '@/lib/platform-admin-auth';

export async function runJumiaOAuthCallbackDiagnostic({
  apiUserId,
  clientId,
  clientSecret,
  code,
  createRedirect,
  diagnosticId,
  redirectUri,
  requestUrl,
  variant,
}: {
  apiUserId: string;
  clientId: string;
  clientSecret: string;
  code: string;
  createRedirect: (query: Record<string, string | undefined>) => NextResponse;
  diagnosticId: string;
  redirectUri: string;
  requestUrl: string;
  variant?: string;
}): Promise<NextResponse> {
  const platformAdminAuth = await getPlatformAdminAuth();
  if (
    platformAdminAuth.status !== 'authenticated' ||
    platformAdminAuth.user.id !== apiUserId
  ) {
    logger.warn({
      message: '[Jumia OAuth Diagnostic] Authorization rejected',
      diagnostic_id: diagnosticId,
      reason: 'platform_admin_required',
    });
    const response = createRedirect({ error: 'diagnostic_forbidden' });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }

  const callbackUrl = new URL(requestUrl);
  const configuredRedirectUrl = new URL(redirectUri);
  logger.info({
    message: '[Jumia OAuth Diagnostic] Callback accepted',
    callback_code_length: code.length,
    callback_host: callbackUrl.hostname,
    callback_path: callbackUrl.pathname,
    diagnostic_id: diagnosticId,
    redirect_host: configuredRedirectUrl.hostname,
    redirect_path: configuredRedirectUrl.pathname,
    variant: variant ?? 'default',
  });

  const tokenExchangeStartedAt = Date.now();
  let tokens: Awaited<ReturnType<typeof exchangeJumiaCode>>;
  try {
    tokens = await exchangeJumiaCode({
      clientId,
      clientSecret,
      code,
      redirectUri,
    });
  } catch (tokenError) {
    const tokenErrorRecord =
      tokenError !== null && typeof tokenError === 'object'
        ? (tokenError as { details?: unknown; status?: number })
        : undefined;
    const tokenErrorDetails = sanitizeJumiaErrorDetails(
      tokenErrorRecord?.details
    );
    logger.error({
      message: 'Jumia OAuth diagnostic token exchange failed',
      diagnostic_id: diagnosticId,
      exchange_duration_ms: Date.now() - tokenExchangeStartedAt,
      variant: variant ?? 'default',
      error:
        tokenError instanceof Error
          ? {
              name: tokenError.name,
              message: tokenError.message,
              status: tokenErrorRecord?.status,
              ...(tokenErrorDetails === undefined
                ? {}
                : { details: tokenErrorDetails }),
            }
          : String(tokenError).slice(0, 200),
    });
    const response = createRedirect({ error: 'token_exchange_failed' });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  }

  const evidence = jumiaOAuthDiagnostic.buildEvidence(tokens);
  logger.info({
    message: '[Jumia OAuth Diagnostic] Token exchange completed',
    access_grant_present: evidence.has_access_token,
    diagnostic_id: diagnosticId,
    exchange_duration_ms: Date.now() - tokenExchangeStartedAt,
    expires_in: evidence.expires_in,
    grant_type: evidence.token_type,
    persistence_skipped: evidence.persistence_skipped,
    refresh_expires_in: evidence.refresh_expires_in,
    refresh_expiry_present: evidence.has_refresh_expires_in,
    refresh_grant_present: evidence.has_refresh_token,
    variant: variant ?? 'default',
  });

  const response = createRedirect(
    jumiaOAuthDiagnostic.buildRedirectQuery({
      diagnosticId,
      tokens,
      variant,
    })
  );
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

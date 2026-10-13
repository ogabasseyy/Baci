import type { NextRequest } from 'next/server';
import {
  getConfiguredAppUrl,
  getJumiaClientId,
  getJumiaClientSecret,
} from '@/env';
import {
  authenticateApiRequest,
  getMerchantIdForApiUser,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { getJumiaRedirectUri } from '@/lib/jumia/helpers';
import { jumiaOAuthDiagnostic } from '@/lib/jumia/oauth-diagnostic';
import { logger } from '@/lib/logger';
import { getMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { runJumiaOAuthCallbackDiagnostic } from './oauth-diagnostic';
import { parseJumiaOAuthDiagnosticContext } from './oauth-diagnostic-context';
import { exchangeJumiaOAuthTokens } from './oauth-exchange';
import { persistJumiaOAuthConnection } from './oauth-persistence';
import { redirectForJumiaOAuthPersistence } from './oauth-persistence-redirect';
import { jumiaOAuthCallbackRedirect } from './oauth-redirect';

/** RFC 6749 standard error codes plus common Jumia-specific ones. */
const KNOWN_OAUTH_ERRORS = new Set([
  'access_denied',
  'invalid_request',
  'unauthorized_client',
  'server_error',
  'temporarily_unavailable',
  'invalid_scope',
]);
// react-doctor-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler -- OAuth providers call callbacks with GET; state cookie, authenticated merchant, and merchant-cookie checks gate persistence.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const rawError = searchParams.get('error');
    const cookieMerchantId = request.cookies.get('jumia_merchant_id')?.value;
    const diagnosticId = request.cookies.get(
      jumiaOAuthDiagnostic.cookieName
    )?.value;

    const storedState = request.cookies.get('jumia_oauth_state')?.value;
    if (!storedState || storedState !== state) {
      logger.error({
        message: 'Jumia Callback State mismatch',
        state: `${state?.slice(0, 8)}...`,
        storedState: `${storedState?.slice(0, 8)}...`,
      });
      const response = jumiaOAuthCallbackRedirect.create(request, {
        error: 'invalid_state',
      });
      response.headers.set('Cache-Control', 'private, no-store');
      return jumiaOAuthCallbackRedirect.clear(response);
    }
    // Mobile flow: pass code back via deep link, don't exchange here
    if (request.cookies.get('jumia_oauth_platform')?.value === 'mobile') {
      if (rawError) {
        const safeError = KNOWN_OAUTH_ERRORS.has(rawError)
          ? rawError
          : 'oauth_error';
        return jumiaOAuthCallbackRedirect.clear(
          jumiaOAuthCallbackRedirect.create(request, { error: safeError })
        );
      }
      if (!code || code.length > 2048) {
        return jumiaOAuthCallbackRedirect.clear(
          jumiaOAuthCallbackRedirect.create(request, { error: 'no_code' })
        );
      }

      const ticketId = request.cookies.get('jumia_ticket_id')?.value;
      if (!ticketId || ticketId.length > 200) {
        return jumiaOAuthCallbackRedirect.clear(
          jumiaOAuthCallbackRedirect.create(request, {
            error: 'ticket_invalid',
          })
        );
      }

      const response = jumiaOAuthCallbackRedirect.create(request, {
        code,
        ticketId,
      });
      return jumiaOAuthCallbackRedirect.clear(response);
    }

    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      logger.error({
        message: 'Jumia Callback Unauthorized',
        error: auth.error,
      });
      return jumiaOAuthCallbackRedirect.create(request, {
        error: 'session_expired',
      });
    }

    const diagnosticContext = parseJumiaOAuthDiagnosticContext({
      diagnosticId,
      storedState,
    });
    if (diagnosticContext.status === 'invalid') {
      const response = jumiaOAuthCallbackRedirect.create(request, {
        error: 'diagnostic_invalid',
      });
      response.headers.set('Cache-Control', 'private, no-store');
      return jumiaOAuthCallbackRedirect.clear(response);
    }
    const validatedDiagnosticId =
      diagnosticContext.status === 'diagnostic'
        ? diagnosticContext.diagnosticId
        : undefined;

    const merchantId = await getMerchantIdForApiUser(auth.supabase);
    if (!merchantId) {
      logger.error({ message: 'Jumia Callback Merchant not found' });
      return jumiaOAuthCallbackRedirect.create(request, {
        error: 'merchant_not_found',
      });
    }

    if (cookieMerchantId && cookieMerchantId !== merchantId) {
      logger.error({
        message: 'Jumia Callback Merchant mismatch',
        cookieMerchantId,
        merchantId,
      });
      return jumiaOAuthCallbackRedirect.create(request, {
        error: 'session_expired',
      });
    }

    if (rawError) {
      const safeError = KNOWN_OAUTH_ERRORS.has(rawError)
        ? rawError
        : 'oauth_error';
      logger.error({
        message: 'Jumia Callback OAuth error',
        error: safeError,
        merchantId,
      });
      return jumiaOAuthCallbackRedirect.create(request, { error: safeError });
    }

    if (!code || code.length > 2048) {
      return jumiaOAuthCallbackRedirect.create(request, { error: 'no_code' });
    }

    const featureAccess = await getMerchantFeatureAccess(
      auth.supabase,
      merchantId,
      'marketplace_sync'
    );
    if (featureAccess.error) {
      logger.error({
        message: 'Jumia Callback Feature access lookup failed',
        merchantId,
        error: featureAccess.error,
      });
      return jumiaOAuthCallbackRedirect.create(request, {
        error: 'plan_verification_failed',
      });
    }
    if (!featureAccess.allowed) {
      return jumiaOAuthCallbackRedirect.create(request, {
        error: 'requires_upgrade',
      });
    }

    const jumiaClientId = getJumiaClientId();
    const jumiaClientSecret = getJumiaClientSecret();
    const appUrl = getConfiguredAppUrl();

    if (!jumiaClientId || !jumiaClientSecret || !appUrl) {
      logger.error({
        message: 'Jumia Callback OAuth credentials missing',
        merchantId,
        hasClientId: Boolean(jumiaClientId),
        hasClientSecret: Boolean(jumiaClientSecret),
        hasAppUrl: Boolean(appUrl),
      });
      return jumiaOAuthCallbackRedirect.create(request, {
        error: 'oauth_not_configured',
      });
    }
    const jumiaRedirectUri = getJumiaRedirectUri(appUrl);

    // VARIANT-TEST: REMOVE — diagnostic harness, see helpers.ts comment.
    const variant = request.cookies.get('jumia_oauth_variant')?.value;

    if (validatedDiagnosticId) {
      return runJumiaOAuthCallbackDiagnostic({
        apiUserId: auth.user.id,
        clientId: jumiaClientId,
        clientSecret: jumiaClientSecret,
        code,
        createRedirect: (query) =>
          jumiaOAuthCallbackRedirect.create(request, query),
        diagnosticId: validatedDiagnosticId,
        redirectUri: jumiaRedirectUri,
        requestUrl: request.url,
        variant,
      });
    }

    const callbackAccess = await getUserAccess(auth.supabase);
    if (
      !callbackAccess ||
      callbackAccess.merchantId !== merchantId ||
      !hasPermission(callbackAccess, 'integrations', 'manage')
    ) {
      logger.error({
        message: 'Jumia Callback Integration permission denied',
        merchantId,
      });
      return jumiaOAuthCallbackRedirect.create(request, {
        error: 'forbidden',
      });
    }

    let tokens: Awaited<ReturnType<typeof exchangeJumiaOAuthTokens>>;
    try {
      tokens = await exchangeJumiaOAuthTokens({
        clientId: jumiaClientId,
        clientSecret: jumiaClientSecret,
        code,
        merchantId,
        redirectUri: jumiaRedirectUri,
        variant,
      });
    } catch {
      return jumiaOAuthCallbackRedirect.create(request, {
        error: 'token_exchange_failed',
      });
    }

    const persistence = await persistJumiaOAuthConnection({
      merchantId,
      supabase: auth.supabase,
      tokens,
    });
    // VARIANT-TEST: REMOVE — append variant outcome to the browser URL.
    const variantResult = variant
      ? `${variant}:has_refresh=${tokens.refresh_token ? 'true' : 'false'},re_exp=${tokens.refresh_expires_in ?? 'null'}`
      : undefined;
    return redirectForJumiaOAuthPersistence(request, {
      persistence,
      variantResult,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('prerendering') ||
        error.message.includes('dynamic server usage'))
    ) {
      throw error;
    }
    logger.error({
      message: 'Jumia Callback internal error',
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : {
              kind: 'NonError',
              type: typeof error,
              summary: String(error).slice(0, 200),
            },
    });
    return jumiaOAuthCallbackRedirect.create(request, {
      error: 'connection_failed',
    });
  }
}

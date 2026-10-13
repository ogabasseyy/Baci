import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { flattenError } from 'zod';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import {
  getJumiaAuthUrl,
  getJumiaRedirectUri,
  JumiaApiError,
} from '@/lib/jumia/helpers';
import {
  getMerchantFeatureAccess,
  merchantFeatureUpgradeResponse,
} from '@/lib/merchant-feature-gates';
import { createClient } from '@/lib/supabase/server';
import { jumiaConnectRequestSchema } from '@/schemas/jumia/connect-request';
import { jumiaOAuthInitiationDiagnostic } from './oauth-diagnostic';
import { handleJumiaSelfAuthorizationConnectRequest } from './self-authorization-connect-request';

interface JumiaConnectPostDependencies {
  getAppUrl: () => string | null | undefined;
  getClientId: () => string | undefined;
  getEncryptionKey: () => string | undefined;
}

export function createJumiaConnectPost(
  dependencies: JumiaConnectPostDependencies
) {
  return async function POST(request: NextRequest) {
    try {
      const cookieStore = await cookies();
      const supabase = createClient(cookieStore);
      const { searchParams } = new URL(request.url);
      const connectionType = searchParams.get('connectionType');
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        if (
          connectionType === 'oauth' &&
          searchParams.get('platform') === 'mobile'
        ) {
          const loginUrl = new URL('/login', request.url);
          loginUrl.searchParams.set('redirectTo', request.url);
          return NextResponse.redirect(loginUrl);
        }
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }

      const csrf = await checkCsrfProtection(request);
      if (!csrf.valid) {
        return (
          csrf.response ??
          NextResponse.json(
            { error: 'CSRF validation failed' },
            { status: 403 }
          )
        );
      }

      // Validate the body before any database work so malformed payloads
      // fail fast with 400 instead of running merchant/feature lookups or
      // falling into the outer 500 handler.
      let rawBody: unknown;
      try {
        rawBody = await request.json();
      } catch {
        return NextResponse.json(
          { error: 'Invalid JSON body' },
          { status: 400 }
        );
      }
      const parsed = jumiaConnectRequestSchema.safeParse(rawBody);
      if (!parsed.success) {
        return NextResponse.json(
          { error: 'Invalid input', details: flattenError(parsed.error) },
          { status: 400 }
        );
      }

      const merchantContext = await getMerchantForApiRequest(supabase, user.id);
      if (!merchantContext) {
        return NextResponse.json(
          { error: 'Merchant not found' },
          { status: 404 }
        );
      }

      const access = toUserAccess(merchantContext);
      if (!hasPermission(access, 'integrations', 'manage')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const merchantId = merchantContext.merchantId;
      const featureAccess = await getMerchantFeatureAccess(
        supabase,
        merchantId,
        'marketplace_sync'
      );
      if (featureAccess.error) {
        console.error(
          '[Jumia Connect] Feature access lookup failed:',
          featureAccess.error
        );
        return NextResponse.json(
          { error: 'Failed to verify merchant plan' },
          { status: 500 }
        );
      }
      if (!featureAccess.allowed) {
        return merchantFeatureUpgradeResponse('marketplace_sync');
      }

      if (parsed.data.connectionType === 'self_authorization') {
        const encryptionKey = dependencies.getEncryptionKey();
        if (!encryptionKey) {
          return NextResponse.json(
            { error: 'Jumia self-authorization is not configured' },
            { status: 503 }
          );
        }
        try {
          return await handleJumiaSelfAuthorizationConnectRequest({
            body: parsed.data,
            encryptionKey,
            merchantId,
            supabase,
          });
        } catch (error) {
          if (error instanceof JumiaApiError) {
            return NextResponse.json(
              { error: error.message },
              { status: error.status }
            );
          }
          throw error;
        }
      }

      const jumiaClientId = dependencies.getClientId();
      const appUrl = dependencies.getAppUrl();
      if (!jumiaClientId || !appUrl) {
        return NextResponse.json(
          { error: 'Jumia OAuth not configured' },
          { status: 500 }
        );
      }
      const state = crypto.randomBytes(16).toString('hex');
      const redirectUrl = getJumiaAuthUrl({
        clientId: jumiaClientId,
        redirectUri: getJumiaRedirectUri(appUrl),
        state,
      });
      const response = NextResponse.json({ success: true, redirectUrl });
      jumiaOAuthInitiationDiagnostic.applyResponse({
        diagnosticRequested: false,
        merchantId,
        platform: null,
        redirectUrl,
        response,
        state,
      });
      return response;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.includes('prerendering') ||
          error.message.includes('dynamic server usage'))
      ) {
        throw error;
      }
      console.error('[Jumia Connect] Error:', error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}

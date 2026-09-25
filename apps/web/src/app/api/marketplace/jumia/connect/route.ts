/**
 * Jumia Connect API Route
 * Initiates OAuth flow to connect merchant's Jumia account
 */

import crypto from 'node:crypto';
import { type NextRequest, NextResponse } from 'next/server';
import {
  getConfiguredAppUrl,
  getJumiaAuthorizationEncryptionKey,
  getJumiaClientId,
} from '@/env';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { getJumiaAuthUrl, getJumiaRedirectUri } from '@/lib/jumia/helpers';
import { jumiaOAuthDiagnostic } from '@/lib/jumia/oauth-diagnostic';
import { purgeOrphanedJumiaAuthorization } from '@/lib/jumia/purge-orphaned-jumia-authorization';
import {
  getMerchantFeatureAccess,
  merchantFeatureUpgradeResponse,
} from '@/lib/merchant-feature-gates';
import { deleteJumiaConnectionQuerySchema } from '@/schemas/marketplace';
import { getJumiaConnections } from './get-jumia-connections';
import { handleJumiaMobileTicket } from './mobile-ticket';
import { jumiaOAuthInitiationDiagnostic } from './oauth-diagnostic';
import { createJumiaConnectPost } from './post';

export const POST = createJumiaConnectPost({
  getAppUrl: getConfiguredAppUrl,
  getClientId: getJumiaClientId,
  getEncryptionKey: getJumiaAuthorizationEncryptionKey,
});

/**
 * GET: Check current Jumia connection status
 */
// react-doctor-disable-next-line react-doctor/nextjs-no-side-effect-in-get-handler -- Mobile OAuth handoff opens a GET URL; one-time ticket redemption is UUID-validated, pending-only, and expiry-gated before redirect.
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const connectionType = searchParams.get('connectionType');
    const hasBearerAuth = request.headers
      .get('Authorization')
      ?.startsWith('Bearer ');

    const diagnosticPreAuthResponse =
      jumiaOAuthInitiationDiagnostic.getPreAuthResponse(searchParams);
    if (diagnosticPreAuthResponse) {
      return diagnosticPreAuthResponse;
    }

    const mobileTicketResponse = await handleJumiaMobileTicket(
      request,
      searchParams
    );
    if (mobileTicketResponse) return mobileTicketResponse;

    // --- Shared cookie/bearer auth flow ---
    const auth = await authenticateApiRequest(request);

    if (auth.error || !auth.user || !auth.supabase) {
      if (
        connectionType === 'oauth' &&
        searchParams.get('platform') === 'mobile' &&
        !hasBearerAuth
      ) {
        const loginUrl = new URL('/login', request.url);
        loginUrl.searchParams.set('redirectTo', request.url);
        return NextResponse.redirect(loginUrl);
      }
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get merchant for this user
    const merchantContext = await getMerchantForApiRequest(
      auth.supabase,
      auth.user.id
    );
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const access = toUserAccess(merchantContext);
    if (!hasPermission(access, 'integrations', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const merchantId = merchantContext.merchantId;

    // Handle OAuth Redirect Flow
    if (connectionType === 'oauth') {
      if (!hasPermission(access, 'integrations', 'manage')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }

      const initiationContext = await jumiaOAuthInitiationDiagnostic.getContext(
        {
          apiUserId: auth.user.id,
          searchParams,
        }
      );
      if (!initiationContext.ok) {
        return initiationContext.response;
      }
      const { diagnosticRequested, platform, variant } = initiationContext;

      const featureAccess = await getMerchantFeatureAccess(
        auth.supabase,
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

      const jumiaClientId = getJumiaClientId();
      const appUrl = getConfiguredAppUrl();
      if (!jumiaClientId || !appUrl) {
        return NextResponse.json(
          { error: 'Jumia OAuth not configured' },
          { status: 500 }
        );
      }
      const jumiaRedirectUri = getJumiaRedirectUri(appUrl);

      // Generate state for CSRF protection
      const state = jumiaOAuthDiagnostic.bindState(
        crypto.randomBytes(16).toString('hex'),
        diagnosticRequested
      );

      const redirectUrl = getJumiaAuthUrl({
        clientId: jumiaClientId,
        redirectUri: jumiaRedirectUri,
        state,
        variant,
      });

      // return redirect to Jumia
      const response = NextResponse.redirect(redirectUrl);

      jumiaOAuthInitiationDiagnostic.applyResponse({
        diagnosticRequested,
        merchantId,
        platform,
        redirectUrl,
        response,
        state,
        variant,
      });

      return response;
    }

    // Default: Check connection status
    return getJumiaConnections(auth.supabase, merchantId);
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('prerendering') ||
        error.message.includes('dynamic server usage'))
    ) {
      throw error;
    }
    console.error('[Jumia Connect] Status check error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE: Disconnect Jumia account
 */
export async function DELETE(request: NextRequest) {
  try {
    // CSRF validation
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) {
      return (
        csrf.response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
      );
    }

    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get merchant for this user (prevents IDOR)
    const merchantContext = await getMerchantForApiRequest(
      auth.supabase,
      auth.user.id
    );
    if (!merchantContext) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    const deleteAccess = toUserAccess(merchantContext);
    if (!hasPermission(deleteAccess, 'integrations', 'manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const parsedQuery = deleteJumiaConnectionQuerySchema.safeParse({
      id: searchParams.get('id'),
    });

    if (!parsedQuery.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parsedQuery.error.flatten() },
        { status: 400 }
      );
    }
    const { id: integrationId } = parsedQuery.data;

    // Deactivate the integration scoped to merchant (soft delete for audit trail)
    const { data: updated, error: updateError } = await auth.supabase
      .from('marketplace_integrations')
      .update({ is_active: false })
      .eq('id', integrationId)
      .eq('merchant_id', merchantContext.merchantId)
      .select('id')
      .maybeSingle();

    if (updateError) {
      console.error('[Jumia Disconnect] Error:', updateError);
      return NextResponse.json(
        { error: 'Failed to disconnect' },
        { status: 500 }
      );
    }

    if (!updated) {
      return NextResponse.json(
        { error: 'Integration not found' },
        { status: 404 }
      );
    }

    let cleanupPending = false;
    try {
      const purgeStatus = await purgeOrphanedJumiaAuthorization(
        auth.supabase,
        merchantContext.merchantId,
        integrationId
      );
      if (purgeStatus === 'reactivated') {
        // A concurrent reconnect won the shop lock after our deactivation:
        // the integration is live again, so report the conflict instead of
        // a success toast for a disconnect that did not take effect.
        return NextResponse.json(
          {
            error:
              'Integration was reconnected during disconnect; try again if you still want to disconnect',
          },
          { status: 409 }
        );
      }
      cleanupPending = purgeStatus === 'failed';
    } catch (cleanupError) {
      cleanupPending = true;
      console.error(
        '[Jumia Disconnect] Disconnected; credential cleanup deferred:',
        cleanupError
      );
    }

    return NextResponse.json({
      success: true,
      message: cleanupPending
        ? 'Jumia account disconnected; credential cleanup is pending'
        : 'Jumia account disconnected',
      cleanupPending,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('prerendering') ||
        error.message.includes('dynamic server usage'))
    ) {
      throw error;
    }
    console.error('[Jumia Disconnect] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

import type { NextRequest } from 'next/server';
import { getCartProofEnvironment } from '@/lib/cart/cart-runtime-env';
import {
  HandoffConfigError,
  type IssueHandoffResult,
  issueCartHandoff,
  rpcHandoffMerchantId,
  rpcPreviewHandoff,
} from '@/lib/cart/handoff';
import {
  type CartRequestContextDeps,
  checkCartQuota,
  createAnonMerchantFeatureLookup,
  readCartJsonBody,
  resolveCartRequestContext,
} from '@/lib/cart/request-context';
import { cartErrorResponse, cartJsonResponse } from '@/lib/cart/response';
import { createCartScopedClient } from '@/lib/cart/scoped-client';
import { verifyCartSessionProof } from '@/lib/cart/session-proof';
import { checkCsrfProtection } from '@/lib/csrf';
import { getTrustedClientIdentifier } from '@/lib/rate-limit';
import { getCurrentSlugForAlias } from '@/lib/slug-alias-cache';
import { createAnonClient } from '@/lib/supabase/anon';
import { cartHandoffIssueRequestSchema } from '@/schemas/cart';

function rootDomain(): string {
  return process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? 'usebaci.com';
}

/**
 * POST /api/storefront/cart/handoff
 *
 * Issues a five-minute single-use handoff grant for the origin session
 * and returns its fragment continuation URL. The pairing secret never
 * appears in RPC arguments, operation records or logs — only the URL
 * fragment carries it, and fragments never reach the server.
 */
export async function POST(request: NextRequest) {
  try {
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) {
      return cartErrorResponse('forbidden');
    }

    // Authenticate before reading the body: protected-route work and
    // response selection must not be driven by unauthenticated payloads.
    const context = await resolveCartRequestContext(request, {
      merchant: {
        resolveAlias: getCurrentSlugForAlias,
        rpcClient: createAnonClient(),
        loadMerchantFeatures: createAnonMerchantFeatureLookup(
          createAnonClient()
        ),
      },
      requireScope: 'session',
      verify: (proof) =>
        verifyCartSessionProof(proof, {
          environment: getCartProofEnvironment(),
        }),
      wrongScopeError: 'forbidden',
    } satisfies CartRequestContextDeps);
    if (!context.ok) {
      return cartErrorResponse(context.error);
    }

    const rawBody = await readCartJsonBody(request);
    if (!rawBody.ok) {
      return cartErrorResponse('invalid_request');
    }
    const parsedBody = cartHandoffIssueRequestSchema.safeParse(rawBody.body);
    if (!parsedBody.success) {
      return cartErrorResponse('invalid_request');
    }

    const quota = await checkCartQuota({
      merchantId: context.merchant.id,
      operation: 'handoff_issue',
      subject: context.principal.principalId,
    });
    if (!quota.allowed) {
      return cartErrorResponse('quota_exceeded');
    }

    let issued: IssueHandoffResult;
    try {
      issued = await issueCartHandoff(
        {
          client: createCartScopedClient(context.principal),
          environment: getCartProofEnvironment(),
          merchant: {
            customDomain: context.merchant.customDomain,
            rootDomain: rootDomain(),
            slug: context.merchant.slug,
          },
        },
        context.principal,
        {
          destination: parsedBody.data.destination,
          operationId: parsedBody.data.operationId,
        }
      );
    } catch (error) {
      if (error instanceof HandoffConfigError) {
        return cartErrorResponse('temporarily_unavailable');
      }
      throw error;
    }
    if (!issued.ok) {
      return cartErrorResponse(issued.code ?? 'temporarily_unavailable');
    }
    return cartJsonResponse(
      {
        continueUrl: issued.continueUrl,
        expiresAt: issued.expiresAt,
        handoffId: issued.handoffId,
        replayed: issued.replayed,
      },
      { status: 201 }
    );
  } catch {
    console.error('Unexpected error in POST /api/storefront/cart/handoff');
    return cartErrorResponse('temporarily_unavailable');
  }
}

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * GET /api/storefront/cart/handoff?handoff_id=<uuid>
 *
 * Unauthenticated continuation preview. The handoff id only locates
 * the grant; disclosure is authorized by the pairing token, whose hash
 * the preview binds server-side (the x-handoff-token header). Never
 * consumes the grant.
 */
export async function GET(request: NextRequest) {
  try {
    const handoffId = request.nextUrl.searchParams.get('handoff_id');
    if (!handoffId || !UUID_PATTERN.test(handoffId)) {
      return cartErrorResponse('invalid_request');
    }

    // Bound the expensive preview assembly before it runs: this endpoint
    // is unauthenticated, so a per-client budget applies first and the
    // merchant-scoped budget still applies once the merchant is known.
    const preQuota = await checkCartQuota({
      merchantId: 'handoff-preview',
      operation: 'handoff_preview',
      subject: getTrustedClientIdentifier(request),
    });
    if (!preQuota.allowed) {
      return cartErrorResponse('quota_exceeded');
    }

    const handoffToken = request.headers.get('x-handoff-token')?.trim();
    if (!handoffToken?.startsWith('ch1.')) {
      return cartErrorResponse('not_found');
    }

    // Enforce the merchant-scoped budget before the preview RPC
    // assembles anything: resolve the merchant with the cheap locator.
    const merchantId = await rpcHandoffMerchantId(
      createAnonClient(),
      handoffId,
      handoffToken
    );
    if (!merchantId) {
      // The locator is token-gated: a null result means the id/token
      // pair is already proven invalid, so fail closed here instead of
      // running the expensive preview RPC under only the fixed bucket.
      return cartErrorResponse('not_found');
    }
    const quota = await checkCartQuota({
      merchantId,
      operation: 'handoff_preview',
      subject: getTrustedClientIdentifier(request),
    });
    if (!quota.allowed) {
      return cartErrorResponse('quota_exceeded');
    }

    const preview = await rpcPreviewHandoff(
      createAnonClient(),
      handoffId,
      handoffToken
    );
    if (!preview.ok) {
      return cartErrorResponse(preview.code);
    }

    return cartJsonResponse({
      expiresAt: preview.expiresAt,
      merchant: preview.merchant,
      snapshot: preview.snapshot,
      status: preview.status,
      warnings: preview.warnings,
    });
  } catch {
    console.error('Unexpected error in GET /api/storefront/cart/handoff');
    return cartErrorResponse('temporarily_unavailable');
  }
}

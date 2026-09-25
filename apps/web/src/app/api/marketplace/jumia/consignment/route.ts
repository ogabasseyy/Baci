/**
 * Jumia Consignment (Express) API Route
 *
 * POST — Create a consignment order (send stock to Jumia warehouse)
 * PATCH — Update a consignment order (mark shipped, add tracking)
 */

import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hasPermission } from '@/lib/api-auth';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import {
  JumiaApiError,
  JumiaClient,
  jumiaErrorResponse,
} from '@/lib/jumia/client';
import {
  createConsignmentOrder,
  updateConsignmentOrder,
} from '@/lib/jumia/consignment';
import { logger } from '@/lib/logger';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { sanitizeText } from '@/lib/sanitize-core';
import { createClient } from '@/lib/supabase/server';
import {
  jumiaConsignmentCreateSchema,
  jumiaConsignmentUpdateSchema,
} from '@/schemas/jumia/consignment-api';
import { resolveJumiaConsignmentBusinessClientCode } from './resolve-jumia-consignment-business-client-code';

export { getJumiaConsignmentStock as GET } from './get-jumia-consignment-stock';

/* ------------------------------------------------------------------ */
/*  POST — Create a consignment order                                 */
/* ------------------------------------------------------------------ */

export async function POST(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = jumiaConsignmentCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const {
      integrationId,
      businessClientCode,
      shippingDate,
      products,
      comment,
    } = parsed.data;
    const merchantId = merchantContext.merchantId;

    const featureGateResponse = await requireMerchantFeatureAccess(
      supabase,
      merchantId,
      'marketplace_sync'
    );
    if (featureGateResponse) {
      return featureGateResponse;
    }

    const jumiaClient = await JumiaClient.forIntegration(
      supabase,
      merchantId,
      integrationId
    );
    const resolvedBusinessClientCode =
      resolveJumiaConsignmentBusinessClientCode(
        jumiaClient.marketplaceKey,
        businessClientCode
      );
    if (!resolvedBusinessClientCode.ok) {
      return NextResponse.json(
        {
          error:
            'businessClientCode does not match the selected Jumia marketplace',
        },
        { status: 400 }
      );
    }

    const result = await createConsignmentOrder(jumiaClient, {
      shopId: jumiaClient.shopId,
      businessClientCode: resolvedBusinessClientCode.businessClientCode,
      shippingDate,
      products,
      comment: comment ? sanitizeText(comment, 500) : undefined,
    });

    return NextResponse.json({
      purchaseOrderNumber: result.purchaseOrderNumber,
    });
  } catch (error: unknown) {
    if (error instanceof JumiaApiError) {
      return jumiaErrorResponse(error);
    }
    logger.error({ message: 'Jumia Consignment POST Error', error });
    return NextResponse.json(
      { error: 'Failed to create consignment order' },
      { status: 500 }
    );
  }
}

/* ------------------------------------------------------------------ */
/*  PATCH — Update a consignment order                                */
/* ------------------------------------------------------------------ */

export async function PATCH(request: NextRequest) {
  try {
    const cookieStore = await cookies();
    const supabase = createClient(cookieStore);

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { valid, response } = await checkCsrfProtection(request);
    if (!valid) {
      return (
        response ??
        NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
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

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = jumiaConsignmentUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: z.flattenError(parsed.error) },
        { status: 400 }
      );
    }

    const { integrationId, purchaseOrderNumber, ...updates } = parsed.data;
    const merchantId = merchantContext.merchantId;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No update fields provided' },
        { status: 400 }
      );
    }

    const featureGateResponse = await requireMerchantFeatureAccess(
      supabase,
      merchantId,
      'marketplace_sync'
    );
    if (featureGateResponse) {
      return featureGateResponse;
    }

    const jumiaClient = await JumiaClient.forIntegration(
      supabase,
      merchantId,
      integrationId
    );

    // Sanitize user-supplied string fields before sending to Jumia
    const sanitizedUpdates = {
      ...updates,
      ...(typeof updates.trackingNumber === 'string' && {
        trackingNumber: sanitizeText(updates.trackingNumber, 200),
      }),
      ...(typeof updates.deliveryAgentPhoneNumber === 'string' && {
        deliveryAgentPhoneNumber: sanitizeText(
          updates.deliveryAgentPhoneNumber,
          50
        ),
      }),
      ...(typeof updates.thirdPartyLogisticsName === 'string' && {
        thirdPartyLogisticsName: sanitizeText(
          updates.thirdPartyLogisticsName,
          200
        ),
      }),
    };

    await updateConsignmentOrder(
      jumiaClient,
      purchaseOrderNumber,
      sanitizedUpdates
    );

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    if (error instanceof JumiaApiError) {
      return jumiaErrorResponse(error);
    }
    logger.error({ message: 'Jumia Consignment PATCH Error', error });
    return NextResponse.json(
      { error: 'Failed to update consignment order' },
      { status: 500 }
    );
  }
}

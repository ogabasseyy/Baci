import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { hasPermission } from '@/lib/api-auth';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import {
  JumiaApiError,
  JumiaClient,
  jumiaErrorResponse,
} from '@/lib/jumia/client';
import { getConsignmentStock } from '@/lib/jumia/consignment';
import { logger } from '@/lib/logger';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { createClient } from '@/lib/supabase/server';
import { jumiaConsignmentGetQuerySchema } from '@/schemas/jumia/consignment-api';
import { resolveJumiaConsignmentBusinessClientCode } from './resolve-jumia-consignment-business-client-code';

export async function getJumiaConsignmentStock(
  request: NextRequest
): Promise<Response> {
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

    const { searchParams } = new URL(request.url);
    const parsed = jumiaConsignmentGetQuerySchema.safeParse({
      integrationId: searchParams.get('integrationId'),
      sku: searchParams.get('sku'),
      businessClientCode: searchParams.get('businessClientCode'),
    });

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: z.flattenError(parsed.error),
        },
        { status: 400 }
      );
    }

    const { integrationId, sku, businessClientCode } = parsed.data;
    const merchantId = merchantContext.merchantId;
    const featureGateResponse = await requireMerchantFeatureAccess(
      supabase,
      merchantId,
      'marketplace_sync'
    );
    if (featureGateResponse) return featureGateResponse;

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
    const stock = await getConsignmentStock(
      jumiaClient,
      resolvedBusinessClientCode.businessClientCode,
      sku
    );

    return NextResponse.json(stock);
  } catch (error: unknown) {
    if (error instanceof JumiaApiError) return jumiaErrorResponse(error);
    logger.error({ message: 'Jumia Consignment GET Error', error });
    return NextResponse.json(
      { error: 'Failed to fetch consignment stock' },
      { status: 500 }
    );
  }
}

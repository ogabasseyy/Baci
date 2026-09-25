import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import { getAllCategories } from '@/lib/jumia/catalog';
import { JumiaClient } from '@/lib/jumia/client';
import { JumiaApiError } from '@/lib/jumia/helpers';
import { logger } from '@/lib/logger';
import { jumiaMerchantIdQuerySchema } from '@/schemas/marketplace';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const parsedQuery = jumiaMerchantIdQuerySchema.safeParse({
      merchantId: searchParams.get('merchantId') ?? undefined,
      integrationId: searchParams.get('integrationId') ?? undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: parsedQuery.error.flatten(),
        },
        { status: 400 }
      );
    }
    const { merchantId: requestedMerchantId, integrationId } = parsedQuery.data;

    const auth = await authenticateApiRequest(req);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getUserAccess(auth.supabase);
    if (!access || !hasPermission(access, 'integrations', 'manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const merchantId = access.merchantId;
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      );
    }

    if (requestedMerchantId && requestedMerchantId !== merchantId) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    let jumiaClient: JumiaClient | null = null;
    try {
      jumiaClient = integrationId
        ? await JumiaClient.forIntegration(
            auth.supabase,
            merchantId,
            integrationId
          )
        : await JumiaClient.forMerchant(auth.supabase, merchantId);
    } catch (err) {
      if (err instanceof JumiaApiError && err.status === 404) {
        return NextResponse.json({ categories: [], configured: false });
      }
      throw err;
    }

    const categories = await getAllCategories(jumiaClient);
    return NextResponse.json({ categories, configured: true });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('prerendering') ||
        error.message.includes('dynamic server usage'))
    ) {
      throw error;
    }
    logger.error({ message: 'Jumia Categories Error', error });
    return NextResponse.json(
      { error: 'Failed to fetch categories' },
      { status: 500 }
    );
  }
}

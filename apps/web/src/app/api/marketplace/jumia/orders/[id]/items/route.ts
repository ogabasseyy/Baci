import { type NextRequest, NextResponse } from 'next/server';
import {
  authenticateApiRequest,
  getUserAccess,
  hasPermission,
} from '@/lib/api-auth';
import {
  JumiaApiError,
  JumiaClient,
  jumiaErrorResponse,
} from '@/lib/jumia/client';
import { getOrderItems } from '@/lib/jumia/orders';
import { logger } from '@/lib/logger';
import {
  integrationIdSchema,
  jumiaOrderIdParamSchema,
} from '@/schemas/marketplace';
import { getCachedJumiaOrderItems } from './get-cached-jumia-order-items';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Validate path and query params before any DB calls
    const parsedParams = jumiaOrderIdParamSchema.safeParse(await params);
    if (!parsedParams.success) {
      return NextResponse.json(
        { error: 'Invalid order id', details: parsedParams.error.flatten() },
        { status: 400 }
      );
    }
    const { id } = parsedParams.data;

    const { searchParams } = new URL(request.url);
    const rawIntegrationId = searchParams.get('integrationId');
    if (rawIntegrationId === null) {
      return NextResponse.json(
        { error: 'Missing required query parameter: integrationId' },
        { status: 400 }
      );
    }
    const parsedIntegrationId = integrationIdSchema.safeParse(rawIntegrationId);
    if (!parsedIntegrationId.success) {
      return NextResponse.json(
        {
          error: 'Invalid integrationId',
          details: parsedIntegrationId.error.flatten(),
        },
        { status: 400 }
      );
    }
    const integrationId = parsedIntegrationId.data;

    // Auth check after input validation passes
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const access = await getUserAccess(auth.supabase);
    if (!access || !hasPermission(access, 'integrations', 'view')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const merchantId = access.merchantId;
    if (!merchantId) {
      return NextResponse.json(
        { error: 'Merchant not found' },
        { status: 403 }
      );
    }

    if (!hasPermission(access, 'integrations', 'manage')) {
      const cached = await getCachedJumiaOrderItems({
        supabase: auth.supabase,
        merchantId,
        integrationId,
        orderId: id,
      });
      if (cached.kind === 'database_error') {
        logger.error({
          message: 'Failed to load cached Jumia order items',
          integrationId,
          orderId: id,
          error: cached.message,
        });
        return NextResponse.json(
          { error: 'Failed to fetch cached items' },
          { status: 500 }
        );
      }
      if (cached.kind === 'missing') {
        return NextResponse.json(
          {
            error:
              'Order items are not cached; ask an integrations manager to sync Jumia orders',
          },
          { status: 503 }
        );
      }
      return NextResponse.json({
        orderId: cached.orderId,
        orderNumber: cached.orderNumber,
        items: cached.items,
      });
    }

    let jumiaClient: JumiaClient;
    try {
      jumiaClient = await JumiaClient.forIntegration(
        auth.supabase,
        merchantId,
        integrationId
      );
    } catch (err: unknown) {
      if (err instanceof JumiaApiError) return jumiaErrorResponse(err);
      throw err;
    }

    const orderItems = await getOrderItems(jumiaClient, id);

    return NextResponse.json({
      orderId: orderItems.orderId,
      orderNumber: orderItems.orderNumber,
      items: orderItems.items,
    });
  } catch (error: unknown) {
    if (error instanceof JumiaApiError) return jumiaErrorResponse(error);
    logger.error({ message: 'Jumia Order Items Error', error });
    return NextResponse.json(
      { error: 'Failed to fetch items' },
      { status: 500 }
    );
  }
}

import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { buildPdfContentDisposition } from '@/lib/download-filename';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limiter';
import { generateReceiptBlob } from '@/lib/receipt-pdf-generator';
import {
  getStorefrontAccountDocumentData,
  StorefrontAccountDocumentError,
} from '@/lib/storefront-account-document-data';
import {
  storefrontAccountDocumentParamsSchema,
  storefrontAccountDocumentQuerySchema,
} from '@/schemas/storefront-account-document';

const RATE_LIMIT_WINDOW_MINUTES = 1;
const RETRY_AFTER_SECONDS = String(RATE_LIMIT_WINDOW_MINUTES * 60);

function toErrorResponse(error: unknown) {
  if (error instanceof StorefrontAccountDocumentError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }

  logger.error({
    message: 'Unexpected storefront receipt download error',
    error,
    route: 'storefront/account/orders/[id]/receipt',
  });
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateApiRequest(request);

  if (!auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsedParams = storefrontAccountDocumentParamsSchema.safeParse(
    await params
  );
  const merchantSlug = new URL(request.url).searchParams.get('merchantSlug');
  const parsedQuery = storefrontAccountDocumentQuerySchema.safeParse({
    merchantSlug,
  });

  if (!parsedParams.success || !parsedQuery.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const isAllowed = await checkRateLimit(
    auth.supabase,
    auth.user.id,
    'storefront_account_receipt_download',
    10,
    RATE_LIMIT_WINDOW_MINUTES
  );

  if (!isAllowed) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please try again later.' },
      { status: 429, headers: { 'Retry-After': RETRY_AFTER_SECONDS } }
    );
  }

  try {
    const data = await getStorefrontAccountDocumentData({
      supabase: auth.supabase,
      userId: auth.user.id,
      merchantSlug: parsedQuery.data.merchantSlug,
      orderId: parsedParams.data.id,
    });

    if (!data.order.receipt_eligible) {
      return NextResponse.json(
        {
          error: 'Receipt is not available for this order yet',
          code: 'RECEIPT_NOT_READY',
        },
        { status: 409 }
      );
    }

    // The eligibility gate above already established receipt kind: pass it
    // explicitly instead of letting the generator infer from the payment
    // flag, which stays non-paid on settled manual balances.
    const blob = generateReceiptBlob(data.receiptOrder, data.receiptMerchant, {
      documentKind: 'receipt',
    });

    return new NextResponse(blob, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': buildPdfContentDisposition(
          'receipt',
          data.order.order_number
        ),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}

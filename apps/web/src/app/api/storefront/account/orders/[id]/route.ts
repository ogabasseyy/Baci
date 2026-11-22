import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  getStorefrontAccountDocumentData,
  StorefrontAccountDocumentError,
} from '@/lib/storefront-account-document-data';
import {
  storefrontAccountDocumentParamsSchema,
  storefrontAccountDocumentQuerySchema,
} from '@/schemas/storefront-account-document';

function toErrorResponse(error: unknown) {
  if (error instanceof StorefrontAccountDocumentError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status }
    );
  }

  console.error('Unexpected storefront account order detail error:', error);
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

  try {
    const data = await getStorefrontAccountDocumentData({
      supabase: auth.supabase,
      userId: auth.user.id,
      merchantSlug: parsedQuery.data.merchantSlug,
      orderId: parsedParams.data.id,
      view: 'order',
    });

    return NextResponse.json({ order: data.order });
  } catch (error) {
    return toErrorResponse(error);
  }
}

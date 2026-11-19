import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { hasPermission } from '@/lib/api-auth';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import {
  type ProductListQuery,
  productListQuerySchema,
} from '@/schemas/product-list-query';

type ProductListContext =
  | { response: NextResponse }
  | {
      merchantId: string;
      canViewProductCosts: boolean;
      query: ProductListQuery;
      supabase: ReturnType<typeof createClient>;
    };

export async function getProductListContext(
  request: NextRequest
): Promise<ProductListContext> {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  const queryParams = productListQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams.entries())
  );
  if (!queryParams.success) {
    return {
      response: NextResponse.json(
        {
          error: 'Invalid query parameters',
          details: queryParams.error.flatten(),
        },
        { status: 400 }
      ),
    };
  }

  const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
    requestedMerchantId: queryParams.data.merchantId,
  });
  if (!merchantContext) {
    return {
      response: NextResponse.json(
        { error: 'Merchant not found' },
        { status: 404 }
      ),
    };
  }

  const canViewProductCosts = hasPermission(
    toUserAccess(merchantContext),
    'products',
    'view'
  );

  return {
    merchantId: merchantContext.merchantId,
    canViewProductCosts,
    query: queryParams.data,
    supabase,
  };
}

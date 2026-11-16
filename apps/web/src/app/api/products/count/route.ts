import { cacheLife, cacheTag } from 'next/cache';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createAnonClient } from '@/lib/supabase/anon';

const merchantIdSchema = z.string().uuid();

async function getCachedMerchantProductCount(
  merchantId: string
): Promise<number> {
  'use cache';

  cacheLife('products');
  cacheTag('products', `products-${merchantId}`);

  const supabase = createAnonClient();
  const { data: count, error } = await supabase.rpc(
    'get_merchant_product_count',
    {
      merchant_id_param: merchantId,
    }
  );

  if (error) throw error;
  return count || 0;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawMerchantId = searchParams.get('merchant_id');

  if (!rawMerchantId) {
    return NextResponse.json(
      { error: 'Missing merchant_id parameter' },
      { status: 400 }
    );
  }

  const parsedMerchantId = merchantIdSchema.safeParse(rawMerchantId);
  if (!parsedMerchantId.success) {
    return NextResponse.json(
      { error: 'Invalid merchant_id parameter' },
      { status: 400 }
    );
  }
  const merchantId = parsedMerchantId.data;

  try {
    const count = await getCachedMerchantProductCount(merchantId);

    // Determine recommended search method based on count
    const THRESHOLD = 500;
    const recommendedMethod = count > THRESHOLD ? 'server' : 'client';

    return NextResponse.json(
      {
        count,
        recommendedMethod,
        threshold: THRESHOLD,
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
          'Vercel-Cache-Tag': `products,products-${merchantId}`,
        },
      }
    );
  } catch (error) {
    console.error('Product count error:', error);
    return NextResponse.json(
      { error: 'Failed to get product count' },
      { status: 500 }
    );
  }
}

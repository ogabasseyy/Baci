import { type NextRequest, NextResponse } from 'next/server';
import { getCachedSantaProductList } from '@/ai/santa-data';
import { resolveAgenticChatTenant } from '@/lib/agentic/agentic-chat-tenant';
import { logger } from '@/lib/logger';
import { getEffectiveStock } from '@/lib/product-stock';
import { sanitizeForLog } from '@/lib/sanitize-core';
import { createPublicClient } from '@/lib/supabase/public';
import { santaProductLookupSchema } from '@/schemas/santa-product-lookup';

const UNLIMITED_STOCK_QUANTITY = 9999;

async function handleProductLookup(
  productName: string,
  request: NextRequest
): Promise<NextResponse> {
  const safeProductName = sanitizeForLog(productName);
  const tenant = await resolveAgenticChatTenant(request);
  if (!tenant) {
    return NextResponse.json(
      { error: 'Santa chat is unavailable for this storefront' },
      { status: 503 }
    );
  }

  try {
    const santaProducts = await getCachedSantaProductList(
      tenant.merchantId,
      tenant.priceNegotiationEnabled
    );
    const normalizedSearch = productName.toLowerCase().trim();
    const matchingProduct = santaProducts.find(
      (product) =>
        product.name.toLowerCase() === normalizedSearch ||
        product.name.toLowerCase().includes(normalizedSearch) ||
        normalizedSearch.includes(product.name.toLowerCase())
    );

    if (!matchingProduct) {
      logger.info({
        message: 'Santa Product no match found',
        productName: safeProductName,
      });
      return NextResponse.json({ product: null });
    }

    // This is deliberately a normal public/RLS client: a catalog match does
    // not justify a signed checkout client or a privileged product read.
    const supabase = createPublicClient({ clientInfo: 'baci-santa-product' });
    const { data: product, error } = await supabase
      .from('products')
      .select(
        'id, name, slug, description, price, images, status, merchant_id, stock, stock_quantity, manage_stock, brand, sku'
      )
      .eq('merchant_id', tenant.merchantId)
      .eq('name', matchingProduct.name)
      .eq('status', 'active')
      .maybeSingle();

    if (error) {
      logger.error({
        error: error.message,
        message: 'Santa Product lookup failed',
        productName: safeProductName,
      });
      return NextResponse.json(
        { error: 'Santa product lookup is temporarily unavailable' },
        { status: 503 }
      );
    }

    if (!product) return NextResponse.json({ product: null });

    type ImageEntry = string | { url?: string };
    const images = product.images as ImageEntry[] | null;
    const firstImage = images?.[0];
    const imageUrl =
      typeof firstImage === 'string' ? firstImage : firstImage?.url || '';
    const stock =
      product.manage_stock === false
        ? UNLIMITED_STOCK_QUANTITY
        : getEffectiveStock(product);

    return NextResponse.json(
      {
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug || '',
          description: product.description || '',
          price: product.price,
          image: imageUrl,
          imageLarge: imageUrl,
          imageHint: product.name,
          status: product.status,
          merchant_id: product.merchant_id,
          stock,
          manage_stock: product.manage_stock ?? true,
          brand: product.brand || '',
          sku: product.sku || '',
          gtin: '',
          mpn: '',
        },
      },
      {
        headers: { 'x-baci-santa-merchant-slug': tenant.merchantSlug },
      }
    );
  } catch (error) {
    logger.error({
      error,
      message: 'Santa Product internal error',
      productName: safeProductName,
    });
    return NextResponse.json(
      { error: 'Santa product lookup is temporarily unavailable' },
      { status: 503 }
    );
  }
}

/** POST /api/chat/santa/product Body: { name: string } */
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = santaProductLookupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Product name is required' },
      { status: 400 }
    );
  }
  return handleProductLookup(parsed.data.name, request);
}

/** GET /api/chat/santa/product?name=ProductName */
export function GET(request: NextRequest) {
  const parsed = santaProductLookupSchema.safeParse({
    name: request.nextUrl.searchParams.get('name'),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Product name is required' },
      { status: 400 }
    );
  }
  return handleProductLookup(parsed.data.name, request);
}

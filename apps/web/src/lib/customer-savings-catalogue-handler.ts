import 'server-only';
import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { customerSavingsDraftRequest } from '@/lib/customer-savings-draft-request';
import { resolveWalletTopUpMerchant } from '@/lib/resolve-wallet-top-up-merchant';
import { customerSavingsDraftSchemas } from '@/schemas/customer-savings-draft';
import { customerSavingsDraftPublic } from '@/schemas/customer-savings-draft-public';

const { failure, enabled, merchantId } = customerSavingsDraftRequest;
const PAGE_SIZE = 20;

export async function handleCustomerSavingsCatalogue(
  request: NextRequest
): Promise<NextResponse> {
  try {
    const auth = await authenticateApiRequest(request);
    if (auth.error || !auth.user || !auth.supabase)
      return failure(401, 'SAVINGS_DRAFT_UNAUTHORIZED');
    if (!enabled(request)) return failure(403, 'SAVINGS_DRAFT_DISABLED');
    const entries = [...new URL(request.url).searchParams];
    if (new Set(entries.map(([key]) => key)).size !== entries.length)
      return failure(400, 'SAVINGS_DRAFT_INVALID_INPUT');
    const parsed = customerSavingsDraftSchemas.catalogue.safeParse(
      Object.fromEntries(entries)
    );
    if (!parsed.success) return failure(400, 'SAVINGS_DRAFT_INVALID_INPUT');
    const input = parsed.data;
    if (input.merchantId !== merchantId)
      return failure(403, 'SAVINGS_DRAFT_DISABLED');
    const identity = await resolveWalletTopUpMerchant<{ id: string }>(
      auth.supabase,
      { merchantId: input.merchantId },
      'id'
    );
    if (!identity) return failure(404, 'SAVINGS_DRAFT_UNAVAILABLE');
    const { data: customer, error: customerError } = await auth.supabase
      .from('customers')
      .select('id')
      .eq('merchant_id', identity.id)
      .eq('user_id', auth.user.id)
      .maybeSingle();
    if (customerError || !customer)
      return failure(customerError ? 503 : 404, 'SAVINGS_DRAFT_UNAVAILABLE');
    let query = auth.supabase
      .from('products')
      .select('id, name, price, images, condition, has_variants')
      .eq('merchant_id', identity.id)
      .eq('status', 'active')
      .order('name')
      .order('id')
      .range(input.page * PAGE_SIZE, (input.page + 1) * PAGE_SIZE - 1);
    if (input.search)
      query = query.ilike(
        'name',
        `%${input.search.replace(/[\\%_]/g, '\\$&')}%`
      );
    const { data: products, error: productsError } = await query;
    if (productsError) return failure(503, 'SAVINGS_DRAFT_UNAVAILABLE');
    const productIds = (products ?? []).map((product) => product.id);
    if (!productIds.length)
      return NextResponse.json(
        { products: [] },
        { headers: { 'Cache-Control': 'no-store' } }
      );
    const { data: rawVariants, error: variantsError } = await auth.supabase.rpc(
      'get_storefront_product_variants',
      { p_product_ids: productIds }
    );
    if (variantsError) return failure(503, 'SAVINGS_DRAFT_UNAVAILABLE');
    const variants = customerSavingsDraftPublic.catalogueVariants.parse(
      rawVariants ?? []
    );
    const response = customerSavingsDraftPublic.catalogue.parse(
      (products ?? []).map((product) => ({
        ...product,
        variants: variants.filter(
          (variant) => variant.product_id === product.id
        ),
      }))
    );
    return NextResponse.json(
      { products: response },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch {
    return failure(503, 'SAVINGS_DRAFT_UNAVAILABLE');
  }
}

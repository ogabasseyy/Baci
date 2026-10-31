import {
  ImeiReportSchema,
  isImeiServiceTierKey,
  resolveImeiReportDevice,
} from '@baci/shared/imei';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import { DEFAULT_ROOT_DOMAIN } from '@/lib/default-root-domain';
import {
  checkImeiPollRateLimit,
  createRateLimitResponse,
} from '@/lib/rate-limit';
import { resolveStorefrontMerchantFromRequest } from '@/lib/storefront-merchant';
import { resolveVtuCustomer } from '@/lib/vtu-customer-resolution';
import { imeiReportHistoryQuerySchema } from '@/schemas/imei-report-history';

const json = (body: unknown, status = 200) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  });
// Read cached reports only. This path cannot submit, poll a provider, or debit a wallet.
export async function GET(request: Request | NextRequest) {
  const auth = await authenticateApiRequest(request as NextRequest);
  if (auth.error || !auth.user || !auth.supabase)
    return json({ error: 'Unauthorized' }, 401);
  const query = imeiReportHistoryQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams)
  );
  if (!query.success)
    return json({ error: 'Invalid report history request' }, 400);
  const rate = await checkImeiPollRateLimit(request as NextRequest);
  if (!rate.allowed)
    return createRateLimitResponse(rate.limit, rate.remaining, rate.resetTime);
  const merchant = await resolveStorefrontMerchantFromRequest({
    fallbackIdentifier: query.data.merchantSlug,
    request: request as NextRequest,
    lookupError: 'Failed to validate storefront host',
    notFoundError: 'Storefront not found',
    rootDomain: process.env.NEXT_PUBLIC_ROOT_DOMAIN || DEFAULT_ROOT_DOMAIN,
  });
  if (!merchant.success)
    return json({ error: merchant.error }, merchant.status);
  const merchantId = String(merchant.merchant.id);
  const customer = await resolveVtuCustomer({
    merchantId,
    linkEmailMatch: false,
    supabase: auth.supabase,
    user: auth.user,
  });
  if (!customer || customer.user_id !== auth.user.id)
    return json({ reports: [], hasMore: false });
  const offset = query.data.page * 20;
  const { data, error } = await auth.supabase
    .from('imei_lookups')
    .select('id,tier,device_category,created_at,cached_response')
    .eq('merchant_id', merchantId)
    .eq('customer_id', customer.id)
    .eq('status', 'completed')
    .eq('cached_status', 200)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .range(offset, offset + 20);
  if (error) return json({ error: 'Unable to load completed reports' }, 500);
  const rows = data ?? [];
  const reports = rows.slice(0, 20).flatMap((row) => {
    if (
      !isImeiServiceTierKey(row.tier) ||
      row.cached_response?.success !== true
    )
      return [];
    const parsed = ImeiReportSchema.safeParse({
      lookupId: row.id,
      createdAt: row.created_at,
      tier: row.tier,
      device: resolveImeiReportDevice(row.tier, row.device_category),
      result: row.cached_response.data,
    });
    return parsed.success ? [parsed.data] : [];
  });
  return json({ reports, hasMore: rows.length > 20 });
}

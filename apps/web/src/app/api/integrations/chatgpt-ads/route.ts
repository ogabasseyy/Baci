import { type NextRequest, NextResponse } from 'next/server';
import { authenticateApiRequest } from '@/lib/api-auth';
import {
  revalidateFeatures,
  revalidateMerchant,
} from '@/lib/cache-revalidation';
import { checkCsrfProtection } from '@/lib/csrf';
import { getMerchantForApiRequest } from '@/lib/get-merchant-for-api-request';
import { requireMerchantFeatureAccess } from '@/lib/merchant-feature-gates';
import { chatgptAdsSettingsSchema } from '@/schemas/chatgpt-ads-settings';

const json = (value: unknown, status = 200) =>
  NextResponse.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
async function resolve(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if (auth.error || !auth.user || !auth.supabase)
    return { error: json({ error: 'Unauthorized' }, 401) };
  const merchant = await getMerchantForApiRequest(auth.supabase, auth.user.id, {
    requestedMerchantId: request.nextUrl.searchParams.get('merchantId'),
  });
  if (!merchant?.staffAccess.isOwner)
    return {
      error: json(
        { error: 'Only the store owner can manage this connection.' },
        403
      ),
    };
  return { client: auth.supabase, merchantId: merchant.merchantId };
}
async function status(
  client: NonNullable<Awaited<ReturnType<typeof resolve>>['client']>,
  merchantId: string
) {
  const [settings, credential] = await Promise.all([
    client
      .from('merchant_feature_settings')
      .select('chatgpt_pixel_id')
      .eq('merchant_id', merchantId)
      .maybeSingle(),
    client
      .from('merchant_chatgpt_ads_credentials')
      .select('merchant_id')
      .eq('merchant_id', merchantId)
      .maybeSingle(),
  ]);
  if (settings.error || credential.error)
    return json({ error: 'Could not load connection settings.' }, 500);
  return json({
    pixelId: settings.data?.chatgpt_pixel_id ?? null,
    capiConfigured: !!credential.data,
  });
}
export async function GET(request: NextRequest) {
  try {
    const context = await resolve(request);
    if (context.error) return context.error;
    return await status(context.client, context.merchantId);
  } catch {
    return json({ error: 'Could not load connection settings.' }, 500);
  }
}
export async function PATCH(request: NextRequest) {
  try {
    const context = await resolve(request);
    if (context.error) return context.error;
    const csrf = await checkCsrfProtection(request);
    if (!csrf.valid) return json({ error: 'Invalid request origin.' }, 403);
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body.' }, 400);
    }
    const parsed = chatgptAdsSettingsSchema.safeParse(body);
    if (!parsed.success)
      return json({ error: 'Enter a valid Pixel ID and server key.' }, 400);
    if (!parsed.data.disconnect) {
      const blocked = await requireMerchantFeatureAccess(
        context.client,
        context.merchantId,
        'growth_integrations'
      );
      if (blocked) return blocked;
    }
    const result = await context.client.rpc('save_chatgpt_ads_settings', {
      p_merchant_id: context.merchantId,
      p_pixel_id: parsed.data.pixelId ?? undefined,
      p_capi_key: parsed.data.capiKey?.trim() || undefined,
      p_disconnect: parsed.data.disconnect,
    });
    if (result.error)
      return json({ error: 'Could not save connection settings.' }, 500);
    revalidateFeatures(context.merchantId);
    revalidateMerchant(context.merchantId);
    return await status(context.client, context.merchantId);
  } catch {
    return json({ error: 'Could not save connection settings.' }, 500);
  }
}

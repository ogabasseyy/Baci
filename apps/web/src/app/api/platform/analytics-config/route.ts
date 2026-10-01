import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  type PlatformAnalyticsConfig,
  platformAnalyticsConfigRowsSchema,
} from '@/schemas/platform-analytics-config';

const EMPTY_CONFIG: PlatformAnalyticsConfig = {
  facebook_pixel_id: null,
  google_analytics_id: null,
  snapchat_pixel_id: null,
  tiktok_pixel_id: null,
  twitter_pixel_id: null,
};

const CACHE_CONTROL = 'public, s-maxage=300, stale-while-revalidate=600';
const FAILURE_CACHE_CONTROL = 'private, no-store';

function response(
  config: PlatformAnalyticsConfig,
  cacheControl = CACHE_CONTROL
) {
  return NextResponse.json(config, {
    headers: { 'Cache-Control': cacheControl },
  });
}

/** Returns only public analytics identifiers; no service-role client is used. */
export async function GET() {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .rpc('get_public_platform_analytics_config_v1')
      .abortSignal(AbortSignal.timeout(5000));

    if (error) return response(EMPTY_CONFIG, FAILURE_CACHE_CONTROL);

    const parsed = platformAnalyticsConfigRowsSchema.safeParse(data);
    if (!parsed.success) return response(EMPTY_CONFIG, FAILURE_CACHE_CONTROL);

    return response(parsed.data[0] ?? EMPTY_CONFIG);
  } catch {
    return response(EMPTY_CONFIG, FAILURE_CACHE_CONTROL);
  }
}

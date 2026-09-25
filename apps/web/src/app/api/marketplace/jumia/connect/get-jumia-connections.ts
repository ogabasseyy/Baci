import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function getJumiaConnections(
  supabase: SupabaseClient,
  merchantId: string
): Promise<NextResponse> {
  const { data, error } = await supabase
    .from('marketplace_integrations')
    .select(
      'id, shop_id, shop_name, country_code, marketplace_key, is_active, last_sync_at, sync_error, connection_method, token_expires_at'
    )
    .eq('merchant_id', merchantId)
    .eq('platform', 'jumia')
    .eq('is_active', true);

  if (error) {
    console.error('[Jumia Connect] Failed to fetch connection status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch connection status' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    connected: Boolean(data?.length),
    integrations: data ?? [],
  });
}

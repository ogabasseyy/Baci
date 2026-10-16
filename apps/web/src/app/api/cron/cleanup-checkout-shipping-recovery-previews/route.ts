import { type NextRequest, NextResponse } from 'next/server';
import { getCronSecret } from '@/env';
import { constantTimeEqual } from '@/lib/constant-time-equal';
import { createAdminClient } from '@/lib/supabase/admin';

// Fallback retention sweep for checkout-shipping-recovery previews. The
// primary scheduler is pg_cron (guarded schedule in the follow-ups
// migration); this CRON_SECRET-gated endpoint covers environments where
// pg_cron is absent, so unconfirmed PII-bearing previews are still purged and
// confirmed rows still redacted past their windows.
export async function GET(request: NextRequest) {
  const cronSecret = getCronSecret();
  if (!cronSecret) {
    return NextResponse.json(
      { error: 'Server misconfigured' },
      { status: 500 }
    );
  }
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !constantTimeEqual(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc(
    'cleanup_customer_checkout_shipping_recovery_previews' as never,
    { p_limit: 1000 } as never
  );
  if (error) {
    console.error('Error cleaning up checkout shipping recovery previews:', {
      message: error.message,
    });
    return NextResponse.json(
      { error: 'Failed to clean up recovery previews' },
      { status: 500 }
    );
  }
  return NextResponse.json({ purged: data ?? 0 });
}

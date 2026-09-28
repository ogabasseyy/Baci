import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/ai/provider';
import { hasPermission } from '@/lib/api-permissions';
import { checkCsrfProtection } from '@/lib/csrf';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { createClient } from '@/lib/supabase/server';
import { discoveryBackfillSchema } from '@/schemas/discovery-backfill';
import { backfillDiscoveryBatch } from '../../../../../mcp-server/backfill-discovery-batch';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const csrf = await checkCsrfProtection(request);
  if (!csrf.valid) {
    return (
      csrf.response ??
      NextResponse.json({ error: 'CSRF validation failed' }, { status: 403 })
    );
  }

  const supabase = createClient(await cookies());
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = discoveryBackfillSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  }

  const merchant = await getMerchantForApiRequest(supabase, user.id, {
    requestedMerchantId: parsed.data.merchantId,
  });
  if (merchant?.merchantSlug !== 'ogabassey') {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  if (!hasPermission(toUserAccess(merchant), 'products', 'edit')) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 });
  }

  const rate = checkRateLimit(`discovery-backfill:${user.id}`, {
    requests: 20,
    windowMs: 60_000,
  });
  if (!rate.allowed) {
    return NextResponse.json(
      {
        error: 'Please wait before continuing',
        resetIn: Math.ceil(rate.resetIn / 1000),
      },
      { status: 429 }
    );
  }
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return NextResponse.json(
      { error: 'Discovery indexing is unavailable' },
      { status: 503 }
    );
  }

  try {
    const result = await backfillDiscoveryBatch({
      supabase,
      merchantId: merchant.merchantId,
      cursor: parsed.data.cursor,
      geminiKey,
    });
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    console.error('Discovery backfill batch failed');
    return NextResponse.json(
      { error: 'Discovery indexing failed. Retry this batch.' },
      { status: 502 }
    );
  }
}

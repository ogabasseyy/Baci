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
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '';
    const providerStatus = /^Embedding provider returned (\d{3})$/.exec(
      message
    )?.[1];
    if (providerStatus === '429') {
      console.error('Discovery backfill provider rate limited');
      return NextResponse.json(
        {
          error: 'Embedding provider is temporarily rate limited',
          code: 'EMBEDDING_PROVIDER_RATE_LIMITED',
          resetIn: 60,
        },
        { status: 429 }
      );
    }
    const safeReason =
      /^(?:Catalog read failed|Embedding state read failed|Embedding write failed): (?:[A-Z0-9]{5}|PGRST\d{3})$/.test(
        message
      ) ||
      /^Embedding provider returned \d{3}$/.test(message) ||
      message === 'Embedding provider returned an invalid vector'
        ? message
        : 'unknown';
    console.error('Discovery backfill batch failed', { reason: safeReason });
    return NextResponse.json(
      { error: 'Discovery indexing failed. Retry this batch.' },
      { status: 502 }
    );
  }
}

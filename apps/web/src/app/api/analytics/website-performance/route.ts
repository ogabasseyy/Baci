import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { generateTextWithChain } from '@/ai/generate-text-with-chain';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { requestGemmaCompletion } from '@/lib/gemma/gemma-completion';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { resolveWebsitePerformanceGemmaConfig } from './gemma-config';
import { aggregateWebsitePerformance } from './website-performance-aggregation';

export const maxDuration = 30;

const MAX_FALLBACK_EVENT_ROWS = 10_000;

// Tight per-provider budget: the route has a 30s total budget and the legacy
// VPS Gemma fallback below still needs its own 15s window. The overall budget
// caps the WHOLE walk (per-provider × N providers would otherwise exceed 30s
// and starve the VPS fallback): 12s chain + 15s VPS = 27s < 30s maxDuration.
const WEBSITE_PERFORMANCE_CHAIN_PROVIDER_TIMEOUT_MS = 8_000;
const WEBSITE_PERFORMANCE_CHAIN_BUDGET_MS = 12_000;

// Splits free-text model output into up to 2 short takeaway lines, stripping
// common bullet markers. Shared by the chain and legacy Gemma branches below.
function parseFreeTextInsights(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/^[-*•]\s*/, ''))
    .filter(Boolean)
    .slice(0, 2);
}

const querySchema = z.object({
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  branchId: z.string().optional(),
});

export async function GET(request: NextRequest) {
  const {
    error: authError,
    supabase,
    user,
  } = await authenticateApiRequest(request);

  if (authError || !user || !supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawQuery = {
    startDate: searchParams.get('startDate') || undefined,
    endDate: searchParams.get('endDate') || undefined,
    branchId: searchParams.get('branchId') || undefined,
  };

  const parseResult = querySchema.safeParse(rawQuery);

  if (!parseResult.success) {
    return NextResponse.json(
      { code: 'INVALID_QUERY', error: 'Invalid query parameters' },
      { status: 400 }
    );
  }

  const { startDate, endDate, branchId } = parseResult.data;

  if (branchId) {
    return NextResponse.json(
      {
        code: 'UNSUPPORTED_SCOPE',
        error:
          'Branch filtering is not supported for website performance metrics',
      },
      { status: 400 }
    );
  }

  const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
    requestedMerchantId:
      request.nextUrl.searchParams.get('merchantId') || undefined,
  });

  if (!merchantContext) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }

  const userAccess = toUserAccess(merchantContext);
  if (!hasPermission(userAccess, 'analytics', 'view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Set default 30 days if not provided
  let finalStartDate = startDate;
  let finalEndDate = endDate;

  if (!finalStartDate || !finalEndDate) {
    const end = new Date();
    const start = new Date(end);
    start.setDate(end.getDate() - 30);

    if (!finalStartDate) finalStartDate = start.toISOString();
    if (!finalEndDate) finalEndDate = end.toISOString();
  }

  const start = new Date(finalStartDate);
  const end = new Date(finalEndDate);

  if (start > end) {
    return NextResponse.json(
      { code: 'INVALID_QUERY', error: 'startDate cannot be after endDate' },
      { status: 400 }
    );
  }

  const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays > 30) {
    return NextResponse.json(
      {
        code: 'INVALID_DATE_RANGE',
        error: 'Date range cannot exceed 30 days',
      },
      { status: 400 }
    );
  }

  // 1. Fetch Best Seller (using existing get_top_products RPC)
  const { data: topProducts, error: topProductsError } = await supabase.rpc(
    'get_top_products',
    {
      p_merchant_id: merchantContext.merchantId,
      p_start_date: finalStartDate,
      p_end_date: finalEndDate,
      p_limit: 1,
      p_branch_id: null,
    }
  );

  if (topProductsError) {
    return NextResponse.json(
      { error: 'Failed to aggregate best seller' },
      { status: 500 }
    );
  }

  // 2. Aggregate event metrics in PostgreSQL so PostgREST row caps cannot bias
  // search and conversion rankings on high-traffic stores.
  const { data: databaseEventSummary, error: eventsError } = await supabase.rpc(
    'get_website_performance_event_summary',
    {
      p_merchant_id: merchantContext.merchantId,
      p_start_date: finalStartDate,
      p_end_date: finalEndDate,
    }
  );

  let eventSummary: unknown = databaseEventSummary;
  let fallbackTruncated = false;
  if (eventsError?.code === 'PGRST202') {
    const eventRows: Array<{ event_data: unknown; event_type: string }> = [];
    const pageSize = 1000;
    for (let from = 0; from < MAX_FALLBACK_EVENT_ROWS; from += pageSize) {
      const remaining = MAX_FALLBACK_EVENT_ROWS - from;
      const isFinalPage = remaining <= pageSize;
      // Request one extra row on the final page to detect truncation cleanly.
      const pageEnd = isFinalPage
        ? MAX_FALLBACK_EVENT_ROWS
        : from + pageSize - 1;
      const { data: page, error: pageError } = await supabase
        .from('analytics_events')
        .select('event_type, event_data')
        .eq('merchant_id', merchantContext.merchantId)
        .gte('event_timestamp', finalStartDate)
        .lte('event_timestamp', finalEndDate)
        .in('event_type', ['search', 'product_view', 'purchase', 'add_to_cart'])
        .order('event_timestamp', { ascending: false })
        .order('id', { ascending: false })
        .range(from, pageEnd);

      if (pageError) {
        return NextResponse.json(
          { error: 'Failed to aggregate events' },
          { status: 500 }
        );
      }
      const fetched = page ?? [];
      if (isFinalPage && fetched.length > remaining) {
        fallbackTruncated = true;
      }
      eventRows.push(...fetched.slice(0, remaining));
      if (isFinalPage || fetched.length < pageSize) break;
    }
    if (fallbackTruncated) {
      console.warn('[website-performance] Fallback event scan reached limit', {
        maxRows: MAX_FALLBACK_EVENT_ROWS,
        merchantId: merchantContext.merchantId,
      });
    }
    eventSummary = eventRows;
  } else if (eventsError) {
    return NextResponse.json(
      { error: 'Failed to aggregate events' },
      { status: 500 }
    );
  }

  const { bestSeller, mostSearched, topConverting } =
    aggregateWebsitePerformance(topProducts, eventSummary);

  // Generate AI Insights with Gemma
  const gemmaPrompt = `Analyze the following website performance metrics for an e-commerce store and provide 2 brief, actionable insights (max 1 sentence each) for the merchant:
- Best Seller: ${bestSeller ? `${bestSeller.name} (${bestSeller.units_sold} units)` : 'None'}
- Most Searched: ${mostSearched ? `${mostSearched.query} (${mostSearched.count} searches)` : 'None'}
- Top Converting: ${topConverting ? `${topConverting.name} (${topConverting.conversionRate.toFixed(1)}% conversion rate)` : 'None'}`;

  let aiInsights: { insights: string[] } = { insights: [] };

  // Cloud provider chain (Cerebras -> Groq -> Gemini -> Gemini-Lite) runs
  // FIRST to take load off the VPS; the legacy transport is the last resort.
  try {
    const chainResult = await generateTextWithChain({
      prompt: gemmaPrompt,
      perProviderTimeoutMs: WEBSITE_PERFORMANCE_CHAIN_PROVIDER_TIMEOUT_MS,
      overallTimeoutMs: WEBSITE_PERFORMANCE_CHAIN_BUDGET_MS,
    });
    aiInsights = { insights: parseFreeTextInsights(chainResult.text) };
  } catch (chainError) {
    console.warn(
      '[website-performance] cloud provider chain failed; falling back to VPS Gemma:',
      chainError instanceof Error ? chainError.message : String(chainError)
    );

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 15000);

      const gemmaResponse = await requestGemmaCompletion({
        ...resolveWebsitePerformanceGemmaConfig(),
        messages: [{ role: 'user', content: gemmaPrompt }],
        maxTokens: 300,
        signal: controller.signal,
        temperature: 0.2,
      });

      if (
        !gemmaResponse ||
        (typeof gemmaResponse === 'object' &&
          'status' in gemmaResponse &&
          gemmaResponse.status === 'error')
      ) {
        throw new Error(
          gemmaResponse !== null &&
            typeof gemmaResponse === 'object' &&
            'error' in gemmaResponse &&
            typeof gemmaResponse.error === 'string'
            ? gemmaResponse.error
            : 'AI Completion failed'
        );
      }

      if (
        gemmaResponse &&
        typeof gemmaResponse === 'object' &&
        'status' in gemmaResponse &&
        gemmaResponse.status === 'success' &&
        'data' in gemmaResponse &&
        gemmaResponse.data &&
        typeof gemmaResponse.data === 'object' &&
        'insights' in gemmaResponse.data &&
        Array.isArray(gemmaResponse.data.insights)
      ) {
        aiInsights = {
          insights: gemmaResponse.data.insights.map((s) => String(s)),
        };
      } else {
        const text =
          typeof gemmaResponse === 'string'
            ? gemmaResponse
            : JSON.stringify(gemmaResponse);
        aiInsights = { insights: parseFreeTextInsights(text) };
      }
    } catch (error) {
      console.error('Gemma completion error:', error);
      aiInsights = {
        insights: [
          'Website performance data aggregated successfully.',
          'No significant search or conversion trends detected in this period.',
        ],
      };
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  return NextResponse.json({
    scope: { type: 'all' },
    summary: {
      bestSeller,
      mostSearched,
      topConverting,
    },
    aiInsights,
    ...(fallbackTruncated ? { incompleteData: true } : {}),
  });
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import { AI_RATE_LIMITS, checkRateLimit } from '@/ai/provider';
import { parseRequestedMerchantId } from '@/app/api/branches/branch-route-utils';
import {
  generateAnalyticsInsightsWithOllama,
  isAnalyticsInsightsOllamaConfigured,
  sanitizeAnalyticsInsightsContext,
} from '@/lib/analytics/ollama-insights';
import { authenticateApiRequest, hasPermission } from '@/lib/api-auth';
import { cache, generateCacheKey } from '@/lib/cache';
import {
  getMerchantForApiRequest,
  toUserAccess,
} from '@/lib/get-merchant-for-api-request';
import { analyticsInsightsSchema } from '@/schemas/analytics-insights';

export const maxDuration = 30;

// Budgets sized against the 30s maxDuration so the Ollama/static fallback stays
// reachable: the cloud chain walks for at most CHAIN_BUDGET, then the VPS
// single-shot gets OLLAMA_TIMEOUT — 18 + 10 = 28s < 30s, leaving slop for
// cache/serialization. Per-provider caps each attempt; the overall budget caps
// the whole walk (a hung provider can't consume the route deadline).
const AI_INSIGHTS_PER_PROVIDER_TIMEOUT_MS = 12_000;
const AI_INSIGHTS_CHAIN_BUDGET_MS = 18_000;
const AI_INSIGHTS_OLLAMA_TIMEOUT_MS = 10_000;
const AI_INSIGHTS_CACHE_TTL_SECONDS = 86_400;
const AI_INSIGHTS_FALLBACK_CACHE_TTL_SECONDS = 300;

// generateObjectWithChain uses loose JSON mode (no schema is sent to the
// provider), so the prompt must spell out the shape the old direct
// `generateObject({ schema })` call used to enforce via the AI SDK.
const ANALYTICS_INSIGHTS_JSON_SHAPE =
  '{"insights": [{"title": string, "description": string, "type": "positive" | "negative" | "neutral" | "opportunity", "priority": "high" | "medium" | "low", "action": string (optional)}]} — include 3 to 5 items in "insights".';

const FALLBACK_INSIGHTS = {
  insights: [
    {
      title: 'AI Insights Temporarily Unavailable',
      description:
        'AI-powered analytics are currently unavailable. Please try again shortly.',
      type: 'neutral' as const,
      priority: 'low' as const,
      action: 'Refresh this panel in a few minutes.',
    },
  ],
};

async function generateInsights(
  supabase: SupabaseClient,
  merchantId: string,
  userId: string
) {
  // Rate limiting
  const rateLimit = checkRateLimit(
    `insights:${userId}`,
    AI_RATE_LIMITS.insights
  );
  if (!rateLimit.allowed) {
    return {
      error: 'Rate limit exceeded',
      details: `Please wait ${Math.ceil(rateLimit.resetIn / 1000)} seconds before trying again.`,
      status: 429,
    };
  }

  // Generate cache key for AI insights (cached for 1 hour)
  const cacheKey = generateCacheKey('ai-insights', merchantId);

  // Try to get cached insights
  const cachedInsights = cache.get<{
    insights: Array<{
      title: string;
      description: string;
      type: string;
      priority: string;
      action?: string;
    }>;
  }>(cacheKey);
  if (cachedInsights) {
    return { data: cachedInsights };
  }

  // Fetch aggregated data for context
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  // PERFORMANCE: Use Promise.all to fetch analytics context in parallel rather than sequentially,
  // and specify exact columns instead of select('*') to reduce query planning overhead and payload size.
  const [
    { data: salesHistory },
    { data: productPerformance },
    { data: channelPerformance },
  ] = await Promise.all([
    // 1. Daily Sales Summary (Last 30 days)
    supabase
      .from('daily_sales_summary')
      .select(
        'merchant_id, sale_date, order_count, total_revenue, avg_order_value, unique_customers, paid_orders, pending_orders, paid_revenue'
      )
      .eq('merchant_id', merchantId)
      .gte('sale_date', thirtyDaysAgo.toISOString().split('T')[0])
      .order('sale_date', { ascending: true }),

    // 2. Product Performance (Top 10)
    supabase
      .from('product_performance')
      .select(
        'merchant_id, product_id, name, price, times_sold, total_quantity_sold, total_revenue, last_sold_at'
      )
      .eq('merchant_id', merchantId)
      .order('total_revenue', { ascending: false })
      .limit(10),

    // 3. Sales by Channel
    supabase
      .from('sales_by_channel')
      .select(
        'merchant_id, channel, order_count, total_revenue, avg_order_value'
      )
      .eq('merchant_id', merchantId),
  ]);

  // Prepare context for AI
  const context = {
    salesHistory: salesHistory || [],
    topProducts: productPerformance || [],
    channels: channelPerformance || [],
  };

  const safeContext = sanitizeAnalyticsInsightsContext(context);

  const prompt = `
Analyze the following e-commerce data for a merchant and provide 3-5 actionable insights.
Focus on trends, opportunities for growth, and potential issues.

Data Context:
${JSON.stringify(safeContext, null, 2)}

Provide insights in the following categories:
- Revenue trends (growth, decline, stability)
- Product performance (bestsellers, underperformers)
- Channel effectiveness

Be specific and constructive.
Return JSON only, matching this exact shape: ${ANALYTICS_INSIGHTS_JSON_SHAPE}
      `;

  // The cloud provider chain (Cerebras -> Groq -> Gemini -> Gemini-Lite) is
  // tried first so insight generation stops loading the self-hosted VPS. The
  // VPS Ollama transport survives as the last-resort fallback so self-host
  // capability is preserved when every cloud provider is unavailable.
  try {
    const { object } = await generateObjectWithChain({
      schema: analyticsInsightsSchema,
      prompt,
      perProviderTimeoutMs: AI_INSIGHTS_PER_PROVIDER_TIMEOUT_MS,
      overallTimeoutMs: AI_INSIGHTS_CHAIN_BUDGET_MS,
    });
    cache.set(cacheKey, object, AI_INSIGHTS_CACHE_TTL_SECONDS);
    return { data: object };
  } catch (chainError) {
    const chainErrorMessage =
      chainError instanceof Error ? chainError.message : String(chainError);

    if (isAnalyticsInsightsOllamaConfigured()) {
      try {
        const object = await generateAnalyticsInsightsWithOllama(safeContext, {
          timeoutMs: AI_INSIGHTS_OLLAMA_TIMEOUT_MS,
        });
        cache.set(cacheKey, object, AI_INSIGHTS_CACHE_TTL_SECONDS);
        return { data: object };
      } catch (ollamaError) {
        console.warn('AI insights generation unavailable; using fallback', {
          merchantId,
          provider: 'ollama',
          error:
            ollamaError instanceof Error
              ? ollamaError.message
              : String(ollamaError),
        });
        cache.set(
          cacheKey,
          FALLBACK_INSIGHTS,
          AI_INSIGHTS_FALLBACK_CACHE_TTL_SECONDS
        );
        return { data: FALLBACK_INSIGHTS };
      }
    }

    console.warn('AI insights generation unavailable; using fallback', {
      merchantId,
      provider: 'chain',
      error: chainErrorMessage,
    });
    // Short-cache fallback insights to avoid repeated upstream timeouts while
    // keeping recovery quick when the VPS/provider becomes responsive again.
    cache.set(
      cacheKey,
      FALLBACK_INSIGHTS,
      AI_INSIGHTS_FALLBACK_CACHE_TTL_SECONDS
    );
    return { data: FALLBACK_INSIGHTS };
  }
}

async function handleInsightsRequest(request: Request) {
  const auth = await authenticateApiRequest(request);

  if (auth.error || !auth.user || !auth.supabase) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { supabase, user } = auth;

  const requestedMerchant = parseRequestedMerchantId(request);
  if (requestedMerchant.response) {
    return requestedMerchant.response;
  }

  // Get merchant context (supports both owners and staff members)
  const merchantContext = await getMerchantForApiRequest(supabase, user.id, {
    requestedMerchantId: requestedMerchant.merchantId,
  });
  if (!merchantContext) {
    return NextResponse.json({ error: 'Merchant not found' }, { status: 404 });
  }
  const access = toUserAccess(merchantContext);
  if (!hasPermission(access, 'analytics', 'view')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const merchantId = merchantContext.merchantId;

  const result = await generateInsights(supabase, merchantId, user.id);

  if (result.error) {
    return NextResponse.json(
      { error: result.error, details: result.details },
      { status: result.status }
    );
  }

  return NextResponse.json(result.data);
}

export async function GET(request: Request) {
  try {
    return await handleInsightsRequest(request);
  } catch (error) {
    console.error('Error generating insights:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST handler - same behavior as GET, kept for API compatibility
export async function POST(request: Request) {
  try {
    return await handleInsightsRequest(request);
  } catch (error) {
    console.error('Error generating insights:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

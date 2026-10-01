import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateObjectWithChain } from '@/ai/generate-object-with-chain';
import { checkRateLimit } from '@/ai/provider';
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
import { GET, maxDuration } from './route';

vi.mock('@/ai/generate-object-with-chain', () => ({
  generateObjectWithChain: vi.fn(),
}));

vi.mock('@/ai/provider', () => ({
  AI_RATE_LIMITS: {
    insights: { requests: 5, windowMs: 60_000 },
  },
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/api-auth', () => ({
  authenticateApiRequest: vi.fn(),
  hasPermission: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({
  cache: {
    get: vi.fn(),
    set: vi.fn(),
  },
  generateCacheKey: vi.fn(),
}));

vi.mock('@/lib/get-merchant-for-api-request', () => ({
  getMerchantForApiRequest: vi.fn(),
  toUserAccess: vi.fn(),
}));

vi.mock('@/lib/analytics/ollama-insights', () => ({
  generateAnalyticsInsightsWithOllama: vi.fn(),
  isAnalyticsInsightsOllamaConfigured: vi.fn(),
  sanitizeAnalyticsInsightsContext: vi.fn((context) => context),
}));

type QueryMethod = ReturnType<typeof vi.fn>;
type TerminalMethod = 'eq' | 'order' | 'limit';

type SupabaseQuery = {
  select: QueryMethod;
  eq: QueryMethod;
  gte: QueryMethod;
  order: QueryMethod;
  limit: QueryMethod;
};

function makeQueryResult(
  terminalMethod: TerminalMethod,
  data: unknown[] = []
): SupabaseQuery {
  const promise = Promise.resolve({ data });
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
    order: vi.fn(),
    limit: vi.fn(),
  } as SupabaseQuery;

  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.gte.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query[terminalMethod].mockReturnValue(promise);

  return query;
}

function makeSupabaseMock() {
  const from = vi.fn((table: string) => {
    if (table === 'daily_sales_summary') {
      return makeQueryResult('order');
    }
    if (table === 'product_performance') {
      return makeQueryResult('limit');
    }
    return makeQueryResult('eq');
  });

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1' } },
      }),
    },
    from,
  };
}

describe('GET /api/analytics/insights', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.mocked(authenticateApiRequest).mockResolvedValue({
      error: null,
      supabase: makeSupabaseMock() as unknown as Awaited<
        ReturnType<typeof authenticateApiRequest>
      >['supabase'],
      user: { id: 'user-1' } as Awaited<
        ReturnType<typeof authenticateApiRequest>
      >['user'],
    });
    vi.mocked(getMerchantForApiRequest).mockResolvedValue({
      merchantId: 'merchant-1',
    } as Awaited<ReturnType<typeof getMerchantForApiRequest>>);
    vi.mocked(toUserAccess).mockReturnValue({ permissions: {} } as ReturnType<
      typeof toUserAccess
    >);
    vi.mocked(hasPermission).mockReturnValue(true);
    vi.mocked(checkRateLimit).mockReturnValue({
      allowed: true,
      remaining: 4,
      resetIn: 60_000,
    });
    vi.mocked(generateCacheKey).mockReturnValue('ai-insights:merchant-1');
    vi.mocked(cache.get).mockReturnValue(undefined);
    vi.mocked(isAnalyticsInsightsOllamaConfigured).mockReturnValue(false);
    vi.mocked(sanitizeAnalyticsInsightsContext).mockImplementation(
      (context) => context
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns 401 when authentication fails', async () => {
    vi.mocked(authenticateApiRequest).mockResolvedValueOnce({
      error: 'Invalid token',
      supabase: null,
      user: null,
    } as Awaited<ReturnType<typeof authenticateApiRequest>>);

    const response = await GET(
      new Request('https://usebaci.com/api/analytics/insights')
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Unauthorized' });
    expect(getMerchantForApiRequest).not.toHaveBeenCalled();
  });

  it('returns 404 when merchant context is missing', async () => {
    vi.mocked(getMerchantForApiRequest).mockResolvedValueOnce(null);

    const response = await GET(
      new Request('https://usebaci.com/api/analytics/insights')
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: 'Merchant not found',
    });
    expect(generateObjectWithChain).not.toHaveBeenCalled();
  });

  it('resolves the selected merchant from the request header', async () => {
    vi.mocked(generateObjectWithChain).mockResolvedValue({
      object: { insights: [] },
      providerName: 'test-provider',
    } as Awaited<ReturnType<typeof generateObjectWithChain>>);

    const requestedMerchantId = '123e4567-e89b-42d3-a456-426614174000';
    const response = await GET(
      new Request('https://usebaci.com/api/analytics/insights', {
        headers: { 'x-baci-merchant-id': requestedMerchantId },
      })
    );

    expect(response.status).toBe(200);
    expect(getMerchantForApiRequest).toHaveBeenCalledWith(
      expect.anything(),
      'user-1',
      { requestedMerchantId }
    );
  });

  it('returns 403 when analytics view permission is denied', async () => {
    vi.mocked(hasPermission).mockReturnValueOnce(false);

    const response = await GET(
      new Request('https://usebaci.com/api/analytics/insights')
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(generateObjectWithChain).not.toHaveBeenCalled();
  });

  it('returns 429 when the insights rate limit is exceeded', async () => {
    vi.mocked(checkRateLimit).mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      resetIn: 45_000,
    });

    const response = await GET(
      new Request('https://usebaci.com/api/analytics/insights')
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toEqual({
      error: 'Rate limit exceeded',
      details: 'Please wait 45 seconds before trying again.',
    });
    expect(generateObjectWithChain).not.toHaveBeenCalled();
  });

  it('serves insights from the cloud provider chain first', async () => {
    vi.mocked(generateObjectWithChain).mockResolvedValue({
      object: {
        insights: [
          {
            title: 'Revenue is stable',
            description: 'Sales have stayed consistent over the last month.',
            type: 'positive',
            priority: 'medium',
          },
        ],
      },
      providerName: 'cerebras:gemma-4-31b',
    } as Awaited<ReturnType<typeof generateObjectWithChain>>);

    const response = await GET(
      new Request('https://usebaci.com/api/analytics/insights')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      insights: [
        {
          title: 'Revenue is stable',
        },
      ],
    });
    expect(maxDuration).toBe(30);
    expect(generateObjectWithChain).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: analyticsInsightsSchema,
        perProviderTimeoutMs: 12_000,
        // Overall walk budget keeps the Ollama/static fallback reachable
        // within the 30s maxDuration.
        overallTimeoutMs: 18_000,
      })
    );
    // Chain succeeded, so the VPS Ollama fallback must never be consulted.
    expect(generateAnalyticsInsightsWithOllama).not.toHaveBeenCalled();
  });

  it('sanitizes analytics context before sending the chain prompt', async () => {
    vi.mocked(sanitizeAnalyticsInsightsContext).mockReturnValueOnce({
      salesHistory: [{ total_revenue: 1000 }],
      topProducts: [],
      channels: [],
    });
    vi.mocked(generateObjectWithChain).mockResolvedValue({
      object: {
        insights: [
          {
            title: 'Revenue is stable',
            description: 'Sales have stayed consistent over the last month.',
            type: 'positive',
            priority: 'medium',
          },
        ],
      },
      providerName: 'cerebras:gemma-4-31b',
    } as Awaited<ReturnType<typeof generateObjectWithChain>>);

    const response = await GET(
      new Request('https://usebaci.com/api/analytics/insights')
    );

    expect(response.status).toBe(200);
    expect(generateObjectWithChain).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining('total_revenue'),
      })
    );
    const [{ prompt }] = vi.mocked(generateObjectWithChain).mock.calls[0] ?? [
      {},
    ];
    expect(String(prompt)).not.toContain('customer_email');
    expect(sanitizeAnalyticsInsightsContext).toHaveBeenCalledWith(
      expect.objectContaining({
        salesHistory: expect.any(Array),
        topProducts: expect.any(Array),
        channels: expect.any(Array),
      })
    );
  });

  it('falls back to the VPS Gemma/Ollama transport when the chain is exhausted', async () => {
    vi.mocked(generateObjectWithChain).mockRejectedValue(
      new Error('all object providers failed')
    );
    vi.mocked(isAnalyticsInsightsOllamaConfigured).mockReturnValueOnce(true);
    vi.mocked(generateAnalyticsInsightsWithOllama).mockResolvedValueOnce({
      insights: [
        {
          title: 'Products need attention',
          description: 'Two products drive most revenue this month.',
          type: 'opportunity',
          priority: 'medium',
          action: 'Review inventory for top sellers.',
        },
      ],
    });

    const response = await GET(
      new Request('https://usebaci.com/api/analytics/insights')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      insights: [{ title: 'Products need attention' }],
    });
    expect(generateAnalyticsInsightsWithOllama).toHaveBeenCalledWith(
      expect.objectContaining({
        salesHistory: expect.any(Array),
        topProducts: expect.any(Array),
        channels: expect.any(Array),
      }),
      expect.objectContaining({ timeoutMs: 10_000 })
    );
    expect(cache.set).toHaveBeenCalledWith(
      'ai-insights:merchant-1',
      expect.objectContaining({
        insights: [
          expect.objectContaining({ title: 'Products need attention' }),
        ],
      }),
      86400
    );
  });

  it('returns fallback insights when both the chain and the VPS Gemma/Ollama call fail', async () => {
    vi.mocked(generateObjectWithChain).mockRejectedValue(
      new Error('all object providers failed')
    );
    vi.mocked(isAnalyticsInsightsOllamaConfigured).mockReturnValueOnce(true);
    vi.mocked(generateAnalyticsInsightsWithOllama).mockRejectedValueOnce(
      new Error('Ollama timeout')
    );

    const response = await GET(
      new Request('https://usebaci.com/api/analytics/insights')
    );

    expect(generateAnalyticsInsightsWithOllama).toHaveBeenCalledWith(
      expect.objectContaining({
        salesHistory: expect.any(Array),
        topProducts: expect.any(Array),
        channels: expect.any(Array),
      }),
      expect.objectContaining({ timeoutMs: 10_000 })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      insights: [
        {
          title: 'AI Insights Temporarily Unavailable',
          type: 'neutral',
        },
      ],
    });
    expect(cache.set).toHaveBeenCalledWith(
      'ai-insights:merchant-1',
      expect.objectContaining({
        insights: [
          expect.objectContaining({
            title: 'AI Insights Temporarily Unavailable',
          }),
        ],
      }),
      300
    );
    expect(console.warn).toHaveBeenCalledWith(
      'AI insights generation unavailable; using fallback',
      expect.objectContaining({
        merchantId: 'merchant-1',
        provider: 'ollama',
        error: 'Ollama timeout',
      })
    );
    expect(console.error).not.toHaveBeenCalled();
  });

  it('returns fallback insights when the chain fails and Ollama is not configured', async () => {
    vi.mocked(generateObjectWithChain).mockRejectedValue(
      new Error('model timeout')
    );

    const response = await GET(
      new Request('https://usebaci.com/api/analytics/insights')
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      insights: [
        {
          title: 'AI Insights Temporarily Unavailable',
          type: 'neutral',
        },
      ],
    });
    expect(cache.set).toHaveBeenCalledWith(
      'ai-insights:merchant-1',
      expect.objectContaining({
        insights: [
          expect.objectContaining({
            title: 'AI Insights Temporarily Unavailable',
          }),
        ],
      }),
      300
    );
    expect(generateAnalyticsInsightsWithOllama).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      'AI insights generation unavailable; using fallback',
      expect.objectContaining({
        merchantId: 'merchant-1',
        provider: 'chain',
        error: 'model timeout',
      })
    );
    expect(console.error).not.toHaveBeenCalled();
  });
});

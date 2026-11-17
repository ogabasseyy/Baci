import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { logger } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const QUESTION_ID = '33333333-3333-4333-8333-333333333333';
const MERCHANT_ID = '55555555-5555-4555-8555-555555555555';
const MERCHANT_SLUG = 'ogabassey';
const PRIZE_PRODUCT_ID = '66666666-6666-4666-8666-666666666666';
const PRIZE_VARIANT_ID = '77777777-7777-4777-8777-777777777777';

function testUuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function eventRow(overrides: Record<string, unknown> = {}) {
  return {
    compliance_verified: true,
    ends_at: '2026-05-16T12:00:00.000Z',
    id: EVENT_ID,
    quiz_question_slots: [
      {
        active: true,
        id: QUESTION_ID,
        quiz_question_variants: [
          {
            active: true,
            id: '44444444-4444-4444-8444-444444444444',
          },
        ],
      },
    ],
    regulatory_basis: 'free_skill_competition',
    regulatory_evidence_ref: 'COUNSEL-2026-08-05',
    regulatory_jurisdiction: 'NG-LA',
    settings: { prize_name: 'N50,000 store credit' },
    starts_at: '2026-05-16T10:00:00.000Z',
    status: 'active',
    title: 'May Quiz',
    ...overrides,
  };
}

function getMockQuestionCount(row: unknown) {
  if (!row || typeof row !== 'object') return 0;
  const { quiz_question_slots: slots } = row as {
    quiz_question_slots?: unknown;
  };
  if (!Array.isArray(slots)) return 0;

  return slots.filter((slot) => {
    if (!slot || typeof slot !== 'object') return false;
    const { active, quiz_question_variants: variants } = slot as {
      active?: boolean;
      quiz_question_variants?: Array<{ active?: boolean }> | null;
    };
    return (
      active === true &&
      Array.isArray(variants) &&
      variants.some((variant) => variant.active === true)
    );
  }).length;
}

function getMockQuestionCountsByEventId(
  selectResults: Array<{ data: unknown; error: unknown }>
) {
  const counts = new Map<string, number>();
  for (const result of selectResults) {
    if (!Array.isArray(result.data)) continue;
    for (const row of result.data) {
      if (!row || typeof row !== 'object') continue;
      const id = (row as { id?: unknown }).id;
      if (typeof id === 'string') {
        counts.set(id, getMockQuestionCount(row));
      }
    }
  }
  return counts;
}

function mockAuthenticatedSupabase({
  customerResult = { data: { id: 'customer-1' }, error: null },
  merchantResult = { data: { id: MERCHANT_ID }, error: null },
  questionCountResult,
  selectResult = { data: null, error: null },
  user = { id: 'user-1' },
}: {
  customerResult?: { data: unknown; error: unknown };
  merchantResult?: { data: unknown; error: unknown };
  questionCountResult?: { data: unknown; error: unknown };
  selectResult?:
    | { data: unknown; error: unknown }
    | Array<{ data: unknown; error: unknown }>;
  user?: { id: string } | null;
} = {}) {
  const selectResults = Array.isArray(selectResult)
    ? [...selectResult]
    : [selectResult];
  const defaultQuestionCounts = getMockQuestionCountsByEventId(selectResults);
  const customerBuilder = {
    eq: vi.fn(() => customerBuilder),
    limit: vi.fn(() => customerBuilder),
    maybeSingle: vi.fn().mockResolvedValue(customerResult),
    order: vi.fn(() => customerBuilder),
    select: vi.fn(() => customerBuilder),
  };
  const merchantBuilder = {
    eq: vi.fn(() => merchantBuilder),
    maybeSingle: vi.fn().mockResolvedValue(merchantResult),
    select: vi.fn(() => merchantBuilder),
  };
  const queryBuilder = {
    eq: vi.fn(() => queryBuilder),
    order: vi.fn(() => queryBuilder),
    range: vi.fn().mockImplementation(() =>
      Promise.resolve(
        selectResults.shift() ?? {
          data: [],
          error: null,
        }
      )
    ),
    select: vi.fn(() => queryBuilder),
  };
  const from = vi.fn((table: string) => {
    if (table === 'customers') return customerBuilder;
    if (table === 'merchants') return merchantBuilder;
    return queryBuilder;
  });
  const rpc = vi
    .fn()
    .mockImplementation(
      (_functionName: string, args?: { p_event_ids?: unknown }) => {
        if (questionCountResult) return Promise.resolve(questionCountResult);
        const eventIds = Array.isArray(args?.p_event_ids)
          ? args.p_event_ids
          : [];
        return Promise.resolve({
          data: eventIds.map((eventId) => ({
            event_id: eventId,
            question_count:
              typeof eventId === 'string'
                ? (defaultQuestionCounts.get(eventId) ?? 0)
                : 0,
          })),
          error: null,
        });
      }
    );
  const supabase = {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user },
        error: null,
      }),
    },
    from,
    rpc,
  };

  vi.mocked(createClient).mockResolvedValue(supabase as never);

  return { customerBuilder, from, merchantBuilder, queryBuilder, supabase };
}

function eventsRequest(query = '') {
  const url = new URL(`http://localhost/api/quiz/events${query}`);
  if (
    !url.searchParams.has('merchantId') &&
    !url.searchParams.has('merchantSlug')
  ) {
    url.searchParams.set('merchantId', MERCHANT_ID);
  }
  return new NextRequest(url);
}

function eventsRequestWithoutMerchant(query = '') {
  return new NextRequest(`http://localhost/api/quiz/events${query}`);
}

async function readJson(response: Response) {
  return JSON.parse(await response.text());
}

describe('quiz events route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 401 when the customer is unauthenticated', async () => {
    const { from } = mockAuthenticatedSupabase({ user: null });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({ error: 'Unauthorized' });
    expect(from).not.toHaveBeenCalled();
  });

  it('returns 400 when pagination query values are invalid', async () => {
    const { from } = mockAuthenticatedSupabase();

    const { GET } = await import('./route');
    const response = await GET(eventsRequest('?limit=invalid'));

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      error: 'Invalid input',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('returns 400 when storefront merchant context is missing', async () => {
    const { from } = mockAuthenticatedSupabase();

    const { GET } = await import('./route');
    const response = await GET(eventsRequestWithoutMerchant());

    expect(response.status).toBe(400);
    expect(await readJson(response)).toMatchObject({
      error: 'Invalid input',
    });
    expect(from).not.toHaveBeenCalled();
  });

  it('returns 404 when the requested storefront merchant is not found', async () => {
    mockAuthenticatedSupabase({
      merchantResult: { data: null, error: null },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(404);
    expect(await readJson(response)).toEqual({
      error: 'Store not found',
    });
  });

  it('returns 500 when the event query fails', async () => {
    mockAuthenticatedSupabase({
      selectResult: { data: null, error: { message: 'Database error' } },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({
      error: 'Quiz request failed',
    });
  });

  it('returns 500 when the current customer merchant lookup fails', async () => {
    mockAuthenticatedSupabase({
      customerResult: { data: null, error: { message: 'Customer error' } },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(500);
    expect(await readJson(response)).toEqual({
      error: 'Quiz request failed',
    });
  });

  it('returns an empty event list when the authenticated user is not a customer for the merchant', async () => {
    const { queryBuilder } = mockAuthenticatedSupabase({
      customerResult: { data: null, error: null },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      entryMode: 'free-v1',
      events: [],
      pagination: {
        hasMore: false,
        limit: 20,
        nextOffset: null,
        offset: 0,
      },
    });
    expect(queryBuilder.select).not.toHaveBeenCalled();
  });

  it('returns an empty event list with pagination defaults', async () => {
    const { queryBuilder } = mockAuthenticatedSupabase({
      selectResult: { data: [], error: null },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      entryMode: 'free-v1',
      events: [],
      pagination: {
        hasMore: false,
        limit: 20,
        nextOffset: null,
        offset: 0,
      },
    });
    expect(queryBuilder.range).toHaveBeenCalledWith(0, 49);
  });

  it('maps missing optional event fields to safe response defaults', async () => {
    mockAuthenticatedSupabase({
      selectResult: {
        data: [
          eventRow({
            ends_at: null,
            settings: {},
            starts_at: null,
            status: 'scheduled',
          }),
          eventRow({
            id: '22222222-2222-4222-8222-222222222222',
            settings: { prize_name: '' },
            status: 'closed',
            title: 'Closed Quiz',
          }),
        ],
        error: null,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest('?limit=2'));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      events: [
        {
          endsAt: null,
          prizeName: 'Quiz prize',
          questionCount: 1,
          startsAt: null,
          status: 'scheduled',
        },
        {
          id: '22222222-2222-4222-8222-222222222222',
          prizeName: 'Quiz prize',
          questionCount: 1,
          status: 'closed',
          title: 'Closed Quiz',
        },
      ],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('logs unknown event statuses before mapping them to closed', async () => {
    mockAuthenticatedSupabase({
      selectResult: {
        data: [eventRow({ status: 'unknown_status' })],
        error: null,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      events: [{ status: 'closed' }],
    });
    expect(logger.warn).toHaveBeenCalledWith({
      context: 'mapQuizEventStatus',
      message: 'Unknown quiz event status mapped to closed',
      status: 'unknown_status',
    });
  });

  it('trims configured prize names before returning events', async () => {
    mockAuthenticatedSupabase({
      selectResult: {
        data: [
          eventRow({ settings: { prize_name: '  N50,000 store credit  ' } }),
        ],
        error: null,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      events: [{ prizeName: 'N50,000 store credit' }],
    });
  });

  it('returns product-backed device prize metadata for quiz events', async () => {
    mockAuthenticatedSupabase({
      selectResult: {
        data: [
          eventRow({
            settings: {
              prize_name: 'Fallback prize',
              prize_product_id: PRIZE_PRODUCT_ID,
              prize_product_image_url:
                'https://cdn.example.com/iphone-15-pro-max.png',
              prize_product_name: 'iPhone 15 Pro Max',
              prize_variant_id: PRIZE_VARIANT_ID,
            },
          }),
        ],
        error: null,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      events: [
        {
          prizeName: 'iPhone 15 Pro Max',
          prizeProduct: {
            id: PRIZE_PRODUCT_ID,
            imageUrl: 'https://cdn.example.com/iphone-15-pro-max.png',
            name: 'iPhone 15 Pro Max',
            variantId: PRIZE_VARIANT_ID,
          },
        },
      ],
    });
  });

  it('accepts forward-compatible event settings keys', async () => {
    mockAuthenticatedSupabase({
      selectResult: {
        data: [
          eventRow({
            settings: {
              future_phase_metadata: { display: 'hero' },
              prize_name: '  N50,000 store credit  ',
            },
          }),
        ],
        error: null,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      events: [{ prizeName: 'N50,000 store credit' }],
    });
  });

  it('filters out events with no question slots before returning mobile data', async () => {
    mockAuthenticatedSupabase({
      selectResult: {
        data: [
          eventRow({
            id: '22222222-2222-4222-8222-222222222222',
            quiz_question_slots: [],
          }),
          eventRow(),
        ],
        error: null,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest('?limit=2'));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      events: [
        {
          id: EVENT_ID,
          questionCount: 1,
        },
      ],
    });
  });

  it('filters rows with embedded variant data when no variant is active', async () => {
    mockAuthenticatedSupabase({
      selectResult: {
        data: [
          eventRow({
            id: '22222222-2222-4222-8222-222222222222',
            quiz_question_slots: [
              {
                active: true,
                id: QUESTION_ID,
                quiz_question_variants: [
                  {
                    active: false,
                    id: '44444444-4444-4444-8444-444444444444',
                  },
                ],
              },
            ],
          }),
          eventRow(),
        ],
        error: null,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest('?limit=2'));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      events: [{ id: EVENT_ID, questionCount: 1 }],
    });
  });

  it('filters events whose active slots have no active variants', async () => {
    const { supabase } = mockAuthenticatedSupabase({
      questionCountResult: {
        data: [{ event_id: EVENT_ID, question_count: 0 }],
        error: null,
      },
      selectResult: {
        data: [
          eventRow({
            quiz_question_slots: [{ active: true, id: QUESTION_ID }],
          }),
        ],
        error: null,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(200);
    expect(await readJson(response)).toMatchObject({
      events: [],
    });
    expect(supabase.rpc).toHaveBeenCalledWith(
      'get_quiz_event_question_counts',
      {
        p_event_ids: [EVENT_ID],
      }
    );
  });

  it('computes pagination after filtering events with no question slots', async () => {
    const hiddenRows = Array.from({ length: 50 }, (_, index) =>
      eventRow({
        id: testUuid(index + 1),
        quiz_question_slots: [],
        title: `Hidden Quiz ${index + 1}`,
      })
    );
    const { queryBuilder } = mockAuthenticatedSupabase({
      selectResult: [
        {
          data: hiddenRows,
          error: null,
        },
        {
          data: [
            eventRow(),
            eventRow({
              id: testUuid(51),
              title: 'June Quiz',
            }),
          ],
          error: null,
        },
      ],
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest('?limit=1&offset=0'));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      entryMode: 'free-v1',
      events: [
        {
          endsAt: '2026-05-16T12:00:00.000Z',
          id: EVENT_ID,
          prizeName: 'N50,000 store credit',
          questionCount: 1,
          startsAt: '2026-05-16T10:00:00.000Z',
          status: 'open',
          title: 'May Quiz',
        },
      ],
      pagination: {
        hasMore: true,
        limit: 1,
        nextOffset: 51,
        offset: 0,
      },
    });
    expect(queryBuilder.range).toHaveBeenNthCalledWith(1, 0, 49);
    expect(queryBuilder.range).toHaveBeenNthCalledWith(2, 50, 99);
  });

  it('fails closed in production mode when approval evidence is missing from a listed event', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    mockAuthenticatedSupabase({
      selectResult: {
        data: [
          eventRow({
            compliance_verified: false,
            nlrc_permit_ref: '',
          }),
        ],
        error: null,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest());

    expect(response.status).toBe(403);
    expect(await readJson(response)).toEqual({
      code: 'quiz_production_not_approved',
      error: 'Quiz prizes are not approved for production use',
    });
  });

  it('does not fail the returned production page for a non-compliant prefetched row', async () => {
    vi.stubEnv('QUIZ_PHASE', 'production');
    vi.stubEnv('QUIZ_PRODUCTION_APPROVED', 'true');
    mockAuthenticatedSupabase({
      selectResult: {
        data: [
          eventRow(),
          eventRow({
            compliance_verified: false,
            id: '22222222-2222-4222-8222-222222222222',
            nlrc_permit_ref: '',
            title: 'June Quiz',
          }),
        ],
        error: null,
      },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest('?limit=1&offset=0'));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      entryMode: 'free-v1',
      events: [
        {
          endsAt: '2026-05-16T12:00:00.000Z',
          id: EVENT_ID,
          prizeName: 'N50,000 store credit',
          questionCount: 1,
          startsAt: '2026-05-16T10:00:00.000Z',
          status: 'open',
          title: 'May Quiz',
        },
      ],
      pagination: {
        hasMore: true,
        limit: 1,
        nextOffset: 1,
        offset: 0,
      },
    });
  });

  it('lists quiz events with explicit columns and bounded pagination', async () => {
    const rows = [eventRow()];
    const { customerBuilder, from, merchantBuilder, queryBuilder } =
      mockAuthenticatedSupabase({
        selectResult: { data: rows, error: null },
      });

    const { GET } = await import('./route');
    const response = await GET(
      eventsRequest(`?limit=1&offset=2&merchantSlug=${MERCHANT_SLUG}`)
    );

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      entryMode: 'free-v1',
      events: [
        {
          endsAt: '2026-05-16T12:00:00.000Z',
          id: EVENT_ID,
          prizeName: 'N50,000 store credit',
          questionCount: 1,
          startsAt: '2026-05-16T10:00:00.000Z',
          status: 'open',
          title: 'May Quiz',
        },
      ],
      pagination: {
        hasMore: false,
        limit: 1,
        nextOffset: null,
        offset: 2,
      },
    });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('merchants');
    expect(merchantBuilder.select).toHaveBeenCalledWith('id');
    expect(merchantBuilder.eq).not.toHaveBeenCalledWith('id', MERCHANT_ID);
    expect(merchantBuilder.eq).toHaveBeenCalledWith('slug', MERCHANT_SLUG);
    expect(from).toHaveBeenCalledWith('customers');
    expect(customerBuilder.select).toHaveBeenCalledWith('id');
    expect(customerBuilder.eq).toHaveBeenCalledWith('merchant_id', MERCHANT_ID);
    expect(customerBuilder.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(from).toHaveBeenCalledWith('quiz_events');
    expect(queryBuilder.select).toHaveBeenCalledWith(
      'id, title, status, starts_at, ends_at, settings, regulatory_basis, regulatory_jurisdiction, regulatory_evidence_ref, compliance_verified, quiz_question_slots!inner(id, active)'
    );
    expect(queryBuilder.eq).toHaveBeenCalledWith('merchant_id', MERCHANT_ID);
    // bugfix: v2 (app-only) rows visible to store staff must not be listed.
    expect(queryBuilder.eq).toHaveBeenCalledWith('contract_version', '1');
    expect(queryBuilder.eq).toHaveBeenCalledWith(
      'quiz_question_slots.active',
      'true'
    );
    expect(queryBuilder.eq).not.toHaveBeenCalledWith(
      'quiz_question_slots.quiz_question_variants.active',
      'true'
    );
    expect(queryBuilder.order).toHaveBeenNthCalledWith(1, 'starts_at', {
      ascending: false,
    });
    expect(queryBuilder.order).toHaveBeenNthCalledWith(2, 'id', {
      ascending: true,
    });
    expect(queryBuilder.range).toHaveBeenCalledWith(2, 51);
  });

  it('returns hasMore pagination metadata when one extra row is loaded', async () => {
    const rows = [
      eventRow(),
      eventRow({
        id: '22222222-2222-4222-8222-222222222222',
        title: 'June Quiz',
      }),
    ];
    const { queryBuilder } = mockAuthenticatedSupabase({
      selectResult: { data: rows, error: null },
    });

    const { GET } = await import('./route');
    const response = await GET(eventsRequest('?limit=1&offset=0'));

    expect(response.status).toBe(200);
    expect(await readJson(response)).toEqual({
      entryMode: 'free-v1',
      events: [
        {
          endsAt: '2026-05-16T12:00:00.000Z',
          id: EVENT_ID,
          prizeName: 'N50,000 store credit',
          questionCount: 1,
          startsAt: '2026-05-16T10:00:00.000Z',
          status: 'open',
          title: 'May Quiz',
        },
      ],
      pagination: {
        hasMore: true,
        limit: 1,
        nextOffset: 1,
        offset: 0,
      },
    });
    expect(queryBuilder.range).toHaveBeenCalledWith(0, 49);
  });
});

describe('quiz events dispatcher', () => {
  afterEach(() => {
    vi.doUnmock('./legacy-route');
    vi.doUnmock('./v2-route');
    vi.resetModules();
  });

  it('dispatches requests without the v2 contract header to the legacy handler', async () => {
    const legacyResponse = Response.json({ contract: 'legacy' });
    const getLegacyQuizEvents = vi.fn().mockResolvedValue(legacyResponse);
    const getQuizEventsV2 = vi.fn();
    vi.resetModules();
    vi.doMock('./legacy-route', () => ({ getLegacyQuizEvents }));
    vi.doMock('./v2-route', () => ({ getQuizEventsV2 }));

    const request = eventsRequest();
    const { GET } = await import('./route');
    expect(await GET(request)).toBe(legacyResponse);
    expect(getLegacyQuizEvents).toHaveBeenCalledWith(request);
    expect(getQuizEventsV2).not.toHaveBeenCalled();
  });

  it('dispatches contract version 2 requests to the v2 handler', async () => {
    const v2Response = Response.json({ contract: 2 });
    const getLegacyQuizEvents = vi.fn();
    const getQuizEventsV2 = vi.fn().mockResolvedValue(v2Response);
    vi.resetModules();
    vi.doMock('./legacy-route', () => ({ getLegacyQuizEvents }));
    vi.doMock('./v2-route', () => ({ getQuizEventsV2 }));

    const request = new NextRequest(eventsRequest().url, {
      headers: { 'X-Baci-Quiz-Contract': '2' },
    });
    const { GET } = await import('./route');
    expect(await GET(request)).toBe(v2Response);
    expect(getQuizEventsV2).toHaveBeenCalledWith(request);
    expect(getLegacyQuizEvents).not.toHaveBeenCalled();
  });
});

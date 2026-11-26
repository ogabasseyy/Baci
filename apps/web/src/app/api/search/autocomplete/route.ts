import { cookies } from 'next/headers';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sanitizeSearchQuery } from '@/lib/sanitize-core';
import {
  AUTOCOMPLETE_SATURATED_CODE,
  type AutocompleteSupabase,
  getStorefrontAutocompleteProducts,
} from '@/lib/storefront-search-autocomplete';
import { createClient } from '@/lib/supabase/server';

const POSTGRES_QUERY_CANCELED_CODE = '57014';
const AUTOCOMPLETE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=30, stale-while-revalidate=300',
  'CDN-Cache-Control':
    'public, max-age=120, stale-while-revalidate=600, stale-if-error=600',
  'Vercel-CDN-Cache-Control': 'public, max-age=120, stale-while-revalidate=600',
} as const;
const AutocompleteQuerySchema = z.object({
  q: z.string().trim().min(1),
  merchant_id: z.uuid(),
  limit: z.preprocess(
    (value) =>
      value === undefined || value === null || value === '' ? 10 : value,
    z.coerce.number().int().min(1).max(100)
  ),
});

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const rawParams = {
    q: searchParams.get('q') ?? undefined,
    merchant_id: searchParams.get('merchant_id') ?? undefined,
    limit: searchParams.get('limit') ?? undefined,
  };

  const parsedParams = AutocompleteQuerySchema.safeParse(rawParams);
  if (!parsedParams.success) {
    const fieldErrors = z.flattenError(parsedParams.error).fieldErrors;
    if (fieldErrors.q || (fieldErrors.merchant_id && !rawParams.merchant_id)) {
      return NextResponse.json(
        { error: 'Missing query or merchant_id parameter' },
        { status: 400 }
      );
    }

    if (fieldErrors.merchant_id) {
      return NextResponse.json(
        { error: 'Invalid merchant_id format' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Invalid autocomplete parameters' },
      { status: 400 }
    );
  }

  const { q: rawQuery, merchant_id: merchantId, limit } = parsedParams.data;

  // Sanitize search query
  const query = sanitizeSearchQuery(rawQuery);

  // Don't autocomplete very short queries
  if (query.length < 2) {
    return NextResponse.json({ suggestions: [], popularSearches: [] });
  }

  try {
    const cookieStore = await cookies();
    const supabase = createClient(
      cookieStore
    ) as unknown as AutocompleteSupabase;

    const result = await getStorefrontAutocompleteProducts({
      supabase,
      merchantId,
      query,
      limit,
    });

    // Popular searches disabled — search_analytics table has no data and
    // the popular_searches view caused 16K+ sequential scans per day via
    // RLS policy evaluation on every autocomplete keystroke.
    return NextResponse.json(result, {
      headers: {
        ...AUTOCOMPLETE_CACHE_HEADERS,
        'Vercel-Cache-Tag': `products-${merchantId}`,
      },
    });
  } catch (error) {
    const errorCode =
      typeof error === 'object' && error && 'code' in error
        ? String(error.code)
        : '';

    if (errorCode === AUTOCOMPLETE_SATURATED_CODE) {
      console.warn(
        'Autocomplete saturated; returning empty suggestions for this request'
      );
      return NextResponse.json({
        suggestions: [],
        popularSearches: [],
      });
    }

    if (errorCode === POSTGRES_QUERY_CANCELED_CODE) {
      console.warn(
        'Autocomplete timed out; returning empty suggestions for this request'
      );
      return NextResponse.json({
        suggestions: [],
        popularSearches: [],
      });
    }

    console.error('Autocomplete error:', error);
    return NextResponse.json(
      { error: 'Failed to get autocomplete suggestions' },
      { status: 500 }
    );
  }
}

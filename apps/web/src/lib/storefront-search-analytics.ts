import { after } from 'next/server';
import { logger } from './logger';
import { createPublicClient } from './supabase/public';

export interface StorefrontSearchAnalyticsSupabase {
  from: (table: string) => {
    insert: (value: Record<string, unknown>) => PromiseLike<{ error: unknown }>;
  };
}

function isAfterOutsideRequestScopeError(error: unknown) {
  return (
    error instanceof Error && error.message.includes('outside a request scope')
  );
}

function createSearchAnalyticsClient() {
  return createPublicClient({
    clientInfo: 'baci-storefront-search-analytics',
  });
}

function runSearchAnalyticsAfterResponse(callback: () => Promise<void>) {
  try {
    after(callback);
  } catch (error) {
    if (!isAfterOutsideRequestScopeError(error)) {
      throw error;
    }

    // `after()` is available only inside a Next request/render lifecycle. Keep
    // analytics non-blocking for plain unit tests and non-request callers.
    void callback();
  }
}

async function insertSearchAnalytics({
  supabase,
  merchantId,
  query,
  resultsCount,
}: {
  supabase: StorefrontSearchAnalyticsSupabase;
  merchantId: string;
  query: string;
  resultsCount: number;
}) {
  try {
    const { error: analyticsError } = await supabase
      .from('search_analytics')
      .insert({
        merchant_id: merchantId,
        search_query: query,
        results_count: resultsCount,
        search_method: 'server',
      });

    if (analyticsError) {
      logger.warn({
        message: 'Storefront search analytics insert failed',
        error: analyticsError,
        merchantId,
        query,
      });
    }
  } catch (analyticsError) {
    logger.warn({
      message: 'Storefront search analytics insert failed',
      error: analyticsError,
      merchantId,
      query,
    });
  }
}

/**
 * Records one search submission after the response completes. Callers must
 * invoke this only after the search fully succeeds (ranked call plus any
 * hydration): `after()` runs even for error-panel renders, so scheduling
 * before a fallible step would record partial failures and let a retry
 * recount the same submission.
 */
export function scheduleSearchAnalyticsInsert(args: {
  supabase?: StorefrontSearchAnalyticsSupabase;
  merchantId: string;
  query: string;
  resultsCount: number;
}) {
  const supabase = args.supabase ?? createSearchAnalyticsClient();

  runSearchAnalyticsAfterResponse(() =>
    insertSearchAnalytics({
      ...args,
      supabase,
    })
  );
}

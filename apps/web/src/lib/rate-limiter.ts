interface RateLimitRpcResponse {
  data: boolean | null;
  error: unknown | null;
}

interface RateLimitRpcClient {
  rpc(
    functionName: 'check_rate_limit',
    parameters: {
      endpoint_param: string;
      identifier_param: string;
      max_requests: number;
      window_minutes: number;
    }
  ): PromiseLike<RateLimitRpcResponse>;
}

/**
 * Check rate limit for a specific action
 * @param supabase Supabase client
 * @param identifier User ID or IP address
 * @param endpoint Endpoint or action name (e.g. 'dns_update', 'domain_register')
 * @param maxRequests Maximum requests allowed in the window
 * @param windowMinutes Window size in minutes
 * @param options.failClosed Throw on RPC failure instead of failing open.
 * Expensive or abuse-sensitive budgets (e.g. AI-call tenant caps) must opt
 * in so an outage cannot silently disable the limit.
 * @returns true if allowed, false if limit exceeded
 */
export async function checkRateLimit(
  supabase: RateLimitRpcClient,
  identifier: string,
  endpoint: string,
  maxRequests: number = 100,
  windowMinutes: number = 1,
  options?: { failClosed?: boolean }
): Promise<boolean> {
  const failClosed = options?.failClosed ?? endpoint.startsWith('verify-');
  let response: RateLimitRpcResponse;

  try {
    response = await supabase.rpc('check_rate_limit', {
      identifier_param: identifier,
      endpoint_param: endpoint,
      max_requests: maxRequests,
      window_minutes: windowMinutes,
    });
  } catch (err) {
    console.error('Rate limit exception:', err);
    if (failClosed) throw err;
    return true;
  }

  if (response.error) {
    console.error('Rate limit check error:', response.error);
    if (failClosed) throw response.error;
    return true;
  }

  if (response.data === null) {
    const unavailable = new Error('Rate limit RPC returned no result');
    console.error('Rate limit check returned no result');
    if (failClosed) throw unavailable;
    return true;
  }

  return response.data;
}

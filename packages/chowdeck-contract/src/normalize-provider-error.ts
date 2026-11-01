export type ChowdeckProviderErrorV1 = {
  code:
    | 'provider_authentication_failed'
    | 'provider_rate_limited'
    | 'provider_unavailable'
    | 'provider_response_invalid';
};

export function normalizeProviderError(input: {
  status?: number;
  unsafeCause?: unknown;
}): ChowdeckProviderErrorV1 {
  if (input.status === 401 || input.status === 403)
    return { code: 'provider_authentication_failed' };
  if (input.status === 429) return { code: 'provider_rate_limited' };
  if (input.status !== undefined && input.status >= 500)
    return { code: 'provider_unavailable' };
  return { code: 'provider_response_invalid' };
}

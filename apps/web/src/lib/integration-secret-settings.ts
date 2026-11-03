/** Shared write-only integration field names. Values are never client settings. */
export const INTEGRATION_SECRET_FIELDS = [
  'facebook_capi_token',
  'tiktok_access_token',
  'snapchat_capi_token',
  'ga4_api_secret',
] as const;
export function omitBlankIntegrationSecrets<T extends object>(input: T): T {
  const result = { ...input } as Record<string, unknown>;
  for (const key of INTEGRATION_SECRET_FIELDS)
    if (typeof result[key] === 'string' && !result[key].trim())
      delete result[key];
  return result as T;
}

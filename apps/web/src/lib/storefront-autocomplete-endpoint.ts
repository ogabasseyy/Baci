const DEFAULT_AUTOCOMPLETE_PATH = '/api/search/autocomplete';

export function normalizeAutocompleteOrigin(
  value?: string | null
): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }

  try {
    const parsed = new URL(trimmed);
    const isLocalHttp =
      parsed.protocol === 'http:' &&
      (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
    if (parsed.protocol !== 'https:' && !isLocalHttp) {
      return undefined;
    }
    if (parsed.username || parsed.password) {
      return undefined;
    }
    return parsed.origin;
  } catch {
    return undefined;
  }
}

export function getAutocompleteOrigin(
  env: Record<string, string | undefined> = process.env
): string | undefined {
  return normalizeAutocompleteOrigin(env.NEXT_PUBLIC_AUTOCOMPLETE_URL);
}

export function getAutocompleteEndpoint(
  env: Record<string, string | undefined> = process.env
): string {
  return getAutocompleteOrigin(env) ?? DEFAULT_AUTOCOMPLETE_PATH;
}

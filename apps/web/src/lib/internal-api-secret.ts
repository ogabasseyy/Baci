const initialInternalApiSecret =
  process.env.INTERNAL_API_SECRET?.trim() || undefined;

function isBrowserRuntime(): boolean {
  // Server-route tests run in jsdom, so preserve the existing test allowance.
  return typeof window !== 'undefined' && process.env.NODE_ENV !== 'test';
}

/**
 * Reads the internal API secret without importing the whole environment module.
 * Runtime configuration wins; a blank runtime value falls back to the optional
 * value present when this module was loaded, matching the legacy getter.
 */
export function getInternalApiSecret(): string | undefined {
  if (isBrowserRuntime()) {
    throw new Error('INTERNAL_API_SECRET cannot be accessed on the client');
  }

  return process.env.INTERNAL_API_SECRET?.trim() || initialInternalApiSecret;
}

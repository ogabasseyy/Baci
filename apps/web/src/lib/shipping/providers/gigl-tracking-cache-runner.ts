import 'server-only';

import type { GiglToken } from './gigl.constants';

type TokenCache = {
  load(): Promise<GiglToken | null>;
  save(token: GiglToken): Promise<void>;
  clear(): Promise<void>;
};

export async function runWithGiglTrackingTokenCache<
  Provider extends { readonly currentToken: GiglToken | null },
  Result,
>({
  cache,
  createProvider,
  run,
}: {
  cache: TokenCache;
  createProvider: (initial: GiglToken | null) => Provider;
  run: (provider: Provider) => Promise<Result>;
}): Promise<Result> {
  const initial = await cache.load().catch(() => null);
  const provider = createProvider(initial);
  try {
    return await run(provider);
  } finally {
    try {
      if (provider.currentToken) await cache.save(provider.currentToken);
      else if (initial) await cache.clear();
    } catch {
      // Tracking remains available if the private optimization is unavailable.
    }
  }
}

import 'server-only';

import type { GiglToken } from './gigl.constants';

type TokenCache = {
  load(): Promise<GiglToken | null>;
  save(token: GiglToken): Promise<void>;
  clear(): Promise<void>;
  release?(): Promise<void>;
};

export async function runWithGiglTrackingTokenCache<
  Provider extends { readonly currentToken: GiglToken | null },
  Result,
>({
  cache,
  createProvider,
  onCacheUnavailable = () =>
    console.warn('[gigl-tracking] token cache unavailable'),
  run,
}: {
  cache: TokenCache;
  createProvider: (initial: GiglToken | null) => Provider;
  onCacheUnavailable?: () => void;
  run: (provider: Provider) => Promise<Result>;
}): Promise<Result> {
  const initial = await cache.load().catch(() => {
    onCacheUnavailable();
    return null;
  });
  const initialSnapshot = initial && JSON.stringify(initial);
  let provider: Provider | undefined;
  try {
    provider = createProvider(initial);
    return await run(provider);
  } finally {
    try {
      if (provider?.currentToken) {
        if (JSON.stringify(provider.currentToken) !== initialSnapshot)
          await cache.save(provider.currentToken);
      } else if (provider && initial) await cache.clear();
    } catch {
      // Tracking remains available if the private optimization is unavailable.
      onCacheUnavailable();
    } finally {
      await cache.release?.().catch(() => undefined);
    }
  }
}

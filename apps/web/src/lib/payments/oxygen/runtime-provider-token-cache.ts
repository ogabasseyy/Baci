import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import type { OxygenEnvironment } from './environment';
import { createOxygenTokenCache, type OxygenTokenCache } from './token-cache';
import { loginOxygenPartner } from './transport';

// Tokens stay process-local. Bound identity entries limit retention; no worker
// session or user-selected tenant identity is shared across connections.
const identityKey = randomBytes(32);
const caches = new Map<string, OxygenTokenCache>();
const maxIdentities = 16;

export function oxygenRuntimeProviderToken(configuration: {
  environment: OxygenEnvironment;
  baseUrl: string;
  reference: string;
  secret: string;
}) {
  const { environment, baseUrl, reference, secret } = configuration;
  const identity = createHmac('sha256', identityKey)
    .update(JSON.stringify([environment, baseUrl, reference, secret]))
    .digest('hex');
  let cache = caches.get(identity);
  if (cache) {
    caches.delete(identity);
  } else {
    cache = createOxygenTokenCache({
      expirySkewMs: 30_000,
      login: (_key, credentials) =>
        loginOxygenPartner(
          { fetchImpl: fetch },
          { baseUrl, reference, secret: credentials.secret }
        ),
    });
  }
  caches.set(identity, cache);
  if (caches.size > maxIdentities) {
    const oldest = caches.keys().next().value;
    if (oldest) caches.delete(oldest);
  }
  return cache.getToken({ environment, accountLabel: identity }, { secret });
}

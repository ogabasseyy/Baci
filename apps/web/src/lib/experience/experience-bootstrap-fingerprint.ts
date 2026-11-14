import { createHash } from 'node:crypto';
import { performancePublicBootstrap } from '@/schemas/experience-performance-worker';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonical(item)])
  );
}

/** Fingerprints only public render inputs; epochs and immutable asset URLs are ephemeral. */
export function experienceBootstrapFingerprint(input: unknown) {
  const bootstrap = performancePublicBootstrap.parse(input);
  const payload = {
    ...(bootstrap.currency ? { currency: bootstrap.currency } : {}),
    catalog: bootstrap.catalog,
    capabilities: bootstrap.capabilities,
    route: {
      routeId: bootstrap.route.routeId,
      canonicalPath: bootstrap.route.canonicalPath,
      params: bootstrap.route.params,
      publicDataRevision: bootstrap.route.publicDataRevision,
    },
  };
  return createHash('sha256')
    .update(JSON.stringify(canonical(payload)))
    .digest('hex');
}

import { extractStorefrontRouteMethods } from './extract-storefront-route-methods';
import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { normalizeStorefrontEdgeRouteSegment } from './storefront-edge-route-segment';

type InventoryRow = StorefrontEdgeInventory['rows'][number];
type SourceFile = Readonly<{ bytes: Buffer; sourcePath: string }>;

function compareApiRoutePatterns(left: string, right: string) {
  const leftSegments = left.split('/').filter(Boolean);
  const rightSegments = right.split('/').filter(Boolean);
  const length = Math.max(leftSegments.length, rightSegments.length);
  for (let index = 0; index < length; index += 1) {
    const leftSegment = leftSegments[index];
    const rightSegment = rightSegments[index];
    if (leftSegment === undefined) return -1;
    if (rightSegment === undefined) return 1;
    const rank = (segment: string) =>
      segment.startsWith('{*') ? 0 : segment.startsWith('{') ? 1 : 2;
    const delta = rank(rightSegment) - rank(leftSegment);
    if (delta !== 0) return delta;
    if (leftSegment !== rightSegment)
      return leftSegment.localeCompare(rightSegment);
  }
  return 0;
}

function isApiRouteSource(sourcePath: string) {
  return /\/route\.(?:ts|tsx|js|jsx)$/.test(sourcePath);
}

/** Creates an exact dynamic-origin row for every real Next API route handler. */
export function createStorefrontEdgeApiRows(
  apiRoot: string,
  apiSources: readonly SourceFile[]
): InventoryRow[] {
  const prefix = `${apiRoot.replace(/\/$/, '')}/`;
  return apiSources
    .map<InventoryRow>(({ bytes, sourcePath }) => {
      if (!sourcePath.startsWith(prefix) || !isApiRouteSource(sourcePath))
        throw new Error('storefront API source is outside the API route root');
      const relativeSourcePath = sourcePath.slice(prefix.length);
      const methods = extractStorefrontRouteMethods(bytes.toString('utf8'), {
        includeAutomaticOptions: true,
      });
      if (methods.length === 0)
        throw new Error(
          `storefront API route exports no HTTP method: ${sourcePath}`
        );
      const routeSegments = relativeSourcePath
        .split('/')
        .slice(0, -1)
        .filter(
          (segment) => !(segment.startsWith('(') && segment.endsWith(')'))
        )
        .map(normalizeStorefrontEdgeRouteSegment);
      const routePattern =
        routeSegments.length === 0 ? '/api' : `/api/${routeSegments.join('/')}`;
      return {
        decision: 'origin_dynamic',
        id: `api-route:${relativeSourcePath}`,
        methods,
        reason: 'exact_storefront_api_route',
        routePattern,
        sourceKind: 'api_route',
        sourcePath,
      };
    })
    .sort((left, right) => {
      const routeDelta = compareApiRoutePatterns(
        left.routePattern,
        right.routePattern
      );
      return routeDelta !== 0 ? routeDelta : left.id.localeCompare(right.id);
    });
}

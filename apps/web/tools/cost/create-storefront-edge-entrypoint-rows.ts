import { extractStorefrontRouteMethods } from './extract-storefront-route-methods';
import { STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS } from './storefront-edge-entrypoint-classifications';
import type { StorefrontEdgeInventory } from './storefront-edge-inventory-types';
import { STOREFRONT_EDGE_REDIRECT_ENTRYPOINTS } from './storefront-edge-redirect-entrypoints';
import { normalizeStorefrontEdgeRouteSegment } from './storefront-edge-route-segment';
import { isStorefrontStaticMetadataFile } from './storefront-edge-static-metadata-file';

type InventoryRow = StorefrontEdgeInventory['rows'][number];
type SourceFile = Readonly<{ bytes: Buffer; sourcePath: string }>;

const METADATA_ROUTE_SUFFIXES = new Map<string, string>([
  ['apple-icon.ts', 'apple-icon'],
  ['apple-icon.tsx', 'apple-icon'],
  ['apple-icon.js', 'apple-icon'],
  ['apple-icon.jsx', 'apple-icon'],
  ['icon.ts', 'icon'],
  ['icon.tsx', 'icon'],
  ['icon.js', 'icon'],
  ['icon.jsx', 'icon'],
  ['manifest.ts', 'manifest.webmanifest'],
  ['manifest.tsx', 'manifest.webmanifest'],
  ['manifest.js', 'manifest.webmanifest'],
  ['manifest.jsx', 'manifest.webmanifest'],
  ['opengraph-image.ts', 'opengraph-image'],
  ['opengraph-image.tsx', 'opengraph-image'],
  ['opengraph-image.js', 'opengraph-image'],
  ['opengraph-image.jsx', 'opengraph-image'],
  ['robots.ts', 'robots.txt'],
  ['robots.tsx', 'robots.txt'],
  ['robots.js', 'robots.txt'],
  ['robots.jsx', 'robots.txt'],
  ['sitemap.ts', 'sitemap.xml'],
  ['sitemap.tsx', 'sitemap.xml'],
  ['sitemap.js', 'sitemap.xml'],
  ['sitemap.jsx', 'sitemap.xml'],
  ['twitter-image.ts', 'twitter-image'],
  ['twitter-image.tsx', 'twitter-image'],
  ['twitter-image.js', 'twitter-image'],
  ['twitter-image.jsx', 'twitter-image'],
]);
function entrypointFileName(relativeSourcePath: string) {
  return relativeSourcePath.split('/').at(-1) ?? '';
}

function isRouteHandlerFileName(fileName: string) {
  return (
    fileName === 'route.ts' ||
    fileName === 'route.tsx' ||
    fileName === 'route.js' ||
    fileName === 'route.jsx'
  );
}

function isEntrypoint(relativeSourcePath: string) {
  const fileName = entrypointFileName(relativeSourcePath);
  return (
    fileName === 'page.tsx' ||
    fileName === 'page.ts' ||
    fileName === 'page.js' ||
    fileName === 'page.jsx' ||
    isRouteHandlerFileName(fileName) ||
    METADATA_ROUTE_SUFFIXES.has(fileName) ||
    isStorefrontStaticMetadataFile(fileName)
  );
}

function normalizeClassificationPath(relativeSourcePath: string) {
  if (relativeSourcePath.endsWith('page.ts'))
    return `${relativeSourcePath.slice(0, -'page.ts'.length)}page.tsx`;
  if (relativeSourcePath.endsWith('page.js'))
    return `${relativeSourcePath.slice(0, -'page.js'.length)}page.tsx`;
  if (relativeSourcePath.endsWith('page.jsx'))
    return `${relativeSourcePath.slice(0, -'page.jsx'.length)}page.tsx`;
  if (relativeSourcePath.endsWith('route.js'))
    return `${relativeSourcePath.slice(0, -'route.js'.length)}route.ts`;
  if (relativeSourcePath.endsWith('route.jsx'))
    return `${relativeSourcePath.slice(0, -'route.jsx'.length)}route.ts`;
  if (relativeSourcePath.endsWith('route.tsx'))
    return `${relativeSourcePath.slice(0, -'route.tsx'.length)}route.ts`;
  return relativeSourcePath;
}

function normalizeRoutePattern(relativeSourcePath: string) {
  const fileName = entrypointFileName(relativeSourcePath);
  const metadataSuffix = METADATA_ROUTE_SUFFIXES.get(fileName);
  const segments = relativeSourcePath
    .split('/')
    .slice(0, -1)
    .filter((segment) => !(segment.startsWith('(') && segment.endsWith(')')))
    .map(normalizeStorefrontEdgeRouteSegment);
  if (metadataSuffix) segments.push(metadataSuffix);
  else if (isStorefrontStaticMetadataFile(fileName)) segments.push(fileName);
  return segments.length === 0 ? '/' : `/${segments.join('/')}`;
}

function routeMethods(
  relativeSourcePath: string,
  source: string
): InventoryRow['methods'] {
  const fileName = entrypointFileName(relativeSourcePath);
  if (
    fileName === 'page.tsx' ||
    fileName === 'page.ts' ||
    fileName === 'page.js' ||
    fileName === 'page.jsx' ||
    METADATA_ROUTE_SUFFIXES.has(fileName) ||
    isStorefrontStaticMetadataFile(fileName)
  )
    return ['GET', 'HEAD'];
  const methods = extractStorefrontRouteMethods(source);
  if (methods.length === 0)
    throw new Error(
      `storefront route handler exports no HTTP method: ${relativeSourcePath}`
    );
  return methods;
}

/**
 * Next's matcher prefers static segments, then parameters, then catch-alls.
 * Keep the generated rows in that order so a generic entrypoint cannot shadow
 * a more specific metadata/page route (the source tree is only lexically
 * sorted, which is not routing precedence).
 */
function compareRoutePatterns(left: string, right: string) {
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
    const rankDelta = rank(rightSegment) - rank(leftSegment);
    if (rankDelta !== 0) return rankDelta;
    if (leftSegment !== rightSegment)
      return leftSegment.localeCompare(rightSegment);
  }
  return 0;
}

/** Builds closed route rows from source bytes already bound to origin/main. */
export function createStorefrontEdgeEntrypointRows(
  routeRoot: string,
  routeSources: readonly SourceFile[]
): InventoryRow[] {
  const prefix = `${routeRoot.replace(/\/$/, '')}/`;
  const entrypointSources = routeSources.filter(({ sourcePath }) => {
    if (!sourcePath.startsWith(prefix))
      throw new Error('storefront route source is outside the route root');
    return isEntrypoint(sourcePath.slice(prefix.length));
  });
  const discoveredEntrypoints = new Set(
    entrypointSources.map(({ sourcePath }) =>
      normalizeClassificationPath(sourcePath.slice(prefix.length))
    )
  );
  for (const expected of STOREFRONT_EDGE_REDIRECT_ENTRYPOINTS) {
    if (!discoveredEntrypoints.has(expected))
      throw new Error(`redirect entrypoint no longer exists: ${expected}`);
    if (
      STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.get(expected)?.decision !==
      'edge_redirect'
    )
      throw new Error(
        `redirect entrypoint has no edge_redirect classification: ${expected}`
      );
  }
  for (const expected of STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.keys()) {
    if (!discoveredEntrypoints.has(expected))
      throw new Error(
        `classified storefront entrypoint no longer exists: ${expected}`
      );
  }
  const rows = entrypointSources.flatMap(({ bytes, sourcePath }) => {
    const relativeSourcePath = sourcePath.slice(prefix.length);
    const classificationPath = normalizeClassificationPath(relativeSourcePath);
    const classification =
      STOREFRONT_EDGE_ENTRYPOINT_CLASSIFICATIONS.get(classificationPath);
    if (!classification)
      throw new Error(
        `storefront entrypoint has no reviewed classification: ${relativeSourcePath}`
      );
    const methods = routeMethods(relativeSourcePath, bytes.toString('utf8'));
    const row: InventoryRow = {
      ...classification,
      id: `storefront:${relativeSourcePath}`,
      methods,
      routePattern: normalizeRoutePattern(relativeSourcePath),
      sourceKind: 'storefront_entrypoint',
      sourcePath,
    };
    const slugPrefixedRow: InventoryRow = {
      ...row,
      id: `${row.id}:slug-prefixed`,
      routePattern:
        row.routePattern === '/'
          ? '/{storefrontIdentifier}'
          : `/{storefrontIdentifier}${row.routePattern}`,
      hostCondition: {
        hostKind: 'platform_root_domain',
        precedence: 'before_path_decision',
      },
    };
    if (
      (isRouteHandlerFileName(entrypointFileName(relativeSourcePath)) ||
        METADATA_ROUTE_SUFFIXES.has(entrypointFileName(relativeSourcePath)) ||
        isStorefrontStaticMetadataFile(
          entrypointFileName(relativeSourcePath)
        )) &&
      methods.length > 0 &&
      !methods.includes('OPTIONS')
    ) {
      const optionsRow: InventoryRow = {
        decision: 'origin_dynamic',
        id: `${row.id}:options`,
        methods: ['OPTIONS'],
        reason: 'automatic_options_response',
        routePattern: row.routePattern,
        sourceKind: 'storefront_entrypoint',
        sourcePath,
      };
      const slugOptionsRow: InventoryRow = {
        ...optionsRow,
        id: `${optionsRow.id}:slug-prefixed`,
        routePattern:
          optionsRow.routePattern === '/'
            ? '/{storefrontIdentifier}'
            : `/{storefrontIdentifier}${optionsRow.routePattern}`,
        hostCondition: {
          hostKind: 'platform_root_domain',
          precedence: 'before_path_decision',
        },
      };
      return [row, slugPrefixedRow, optionsRow, slugOptionsRow];
    }
    return [row, slugPrefixedRow];
  });
  return rows.sort((left, right) => {
    const routeDelta = compareRoutePatterns(
      left.routePattern,
      right.routePattern
    );
    if (routeDelta !== 0) return routeDelta;
    return left.id.localeCompare(right.id);
  });
}

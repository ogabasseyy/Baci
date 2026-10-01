interface GraphicsFilterRouteOptions {
  canUseClientFilters: boolean;
  hasServerGraphicsFilter: boolean;
  hasUrlGraphicsSelection: boolean;
}

/**
 * Decide whether a graphics change routes through the server or stays local.
 * Small categories load the full set, so a graphics toggle stays local with
 * the other client facets (brand/price) instead of navigating and silently
 * resetting them. A URL-driven graphics selection still routes through the
 * server because the server-filtered product set is its source of truth.
 */
export function shouldRouteGraphicsChangeThroughServer(
  options: GraphicsFilterRouteOptions
): boolean {
  return (
    options.hasServerGraphicsFilter &&
    (!options.canUseClientFilters || options.hasUrlGraphicsSelection)
  );
}

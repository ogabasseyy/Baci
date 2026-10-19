import boundary from './data/nigeria-adm0-boundary.json';

// GRID3 / geoBoundaries NGA ADM0 (2022), CC BY 4.0. Complete geometry,
// with no inset, simplification or runtime provider request. See data/README.md.
export function isNigeriaRecoveryPin(
  latitude: number,
  longitude: number
): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return false;
  let inside = false;
  // Even/odd crossings include the exterior and exclude any interior rings.
  for (const ring of boundary.coordinates) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const cross = (longitude - xi) * (yj - yi) - (latitude - yi) * (xj - xi);
      if (
        Math.abs(cross) < 1e-12 &&
        longitude >= Math.min(xi, xj) &&
        longitude <= Math.max(xi, xj) &&
        latitude >= Math.min(yi, yj) &&
        latitude <= Math.max(yi, yj)
      )
        return true;
      if (
        yi > latitude !== yj > latitude &&
        longitude < ((xj - xi) * (latitude - yi)) / (yj - yi) + xi
      )
        inside = !inside;
    }
  }
  return inside;
}

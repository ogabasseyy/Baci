/**
 * Sets a key in a Map used as a small per-app-run memory, keeping at most
 * `capacity` entries: the oldest-set key is dropped first. A re-set key
 * moves to the newest position.
 */
export function boundedMapSet<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  capacity: number
): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > capacity) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

export function readPositiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function statePathForMode(path, mode) {
  return path.endsWith('.json')
    ? `${path.slice(0, -'.json'.length)}.${mode}.json`
    : `${path}.${mode}`;
}

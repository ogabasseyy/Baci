export function countDroppedRefs(manifest) {
  const retained = new Set(['inside-output', 'absolute', 'escapes-root']);
  const dropped = new Set([
    'invalid',
    'protected-path',
    'missing',
    'escaped-link',
    'non-file',
  ]);
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    !Array.isArray(manifest.refs) ||
    !Array.isArray(manifest.skipped) ||
    manifest.skipped.some(
      (item) =>
        !item ||
        typeof item !== 'object' ||
        typeof item.reason !== 'string' ||
        (!retained.has(item.reason) && !dropped.has(item.reason))
    )
  ) {
    throw new Error('Invalid preview refs manifest');
  }
  return manifest.skipped.filter((item) => dropped.has(item.reason)).length;
}

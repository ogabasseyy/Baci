export function countDroppedRefs(manifest) {
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
        !item.reason
    )
  ) {
    throw new Error('Invalid preview refs manifest');
  }
  return manifest.skipped.length;
}

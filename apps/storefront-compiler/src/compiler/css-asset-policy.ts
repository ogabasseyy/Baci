export function assertAllowedAssetUrl(
  rawUrl: string,
  sourceLabel: string,
  declaredAssetIds: ReadonlySet<string>
): void {
  const trimmed = rawUrl.trim();
  if (trimmed.startsWith('#')) return;
  if (trimmed.startsWith('/assets/')) {
    const assetId = trimmed.slice('/assets/'.length);
    if (!declaredAssetIds.has(assetId)) {
      throw new Error(`Undeclared asset URL "${trimmed}" in "${sourceLabel}"`);
    }
    return;
  }
  throw new Error(
    `Disallowed CSS url("${trimmed}") in "${sourceLabel}"; declare media in manifest.assets`
  );
}

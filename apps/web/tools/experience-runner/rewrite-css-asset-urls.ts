/** Rewrite whole known asset references, never arbitrary authored text prefixes. */
export function rewriteCssAssetUrls(
  css: string,
  base: string,
  assetIds: readonly string[]
) {
  const urls = new Map(
    assetIds.map((id) => [`/assets/${id}`, `${base}/assets/${id}`])
  );
  return css.replace(
    /(^|["'(\s])(\/assets\/[^"'()\s]+)/g,
    (match, leading: string, path: string) => {
      const rewritten = urls.get(path);
      return rewritten ? leading + rewritten : match;
    }
  );
}

export function extractDependencyUrls(html: string, baseUrl: string): string[] {
  const dependencies = [
    ...html.matchAll(
      /<(?:link|script)\b[^>]*(?:href|src)=["']([^"']+)["'][^>]*>/gi
    ),
  ]
    .map((match) => new URL(match[1] ?? '', baseUrl))
    .filter(({ pathname }) => pathname.startsWith('/_next/static/'))
    .map((asset) => {
      if (asset.origin !== new URL(baseUrl).origin) {
        throw new Error(
          'Cross-origin Next asset is not part of the tested prebuilt output'
        );
      }
      return `${asset.pathname}${asset.search}`;
    });

  return [...new Set(dependencies)].sort();
}

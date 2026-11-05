export function markerNeedles(marker: string): string[] {
  const separator = marker.indexOf('=');
  if (separator === -1) return [marker];
  const name = marker.slice(0, separator);
  const value = marker.slice(separator + 1).replace(/^["']|["']$/g, '');
  return [`${name}="${value}"`, `${name}='${value}'`, `${name}=${value}`];
}

export function hasMarker(value: string, needles: readonly string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

export function hasCompiledMarker(source: string, marker: string): boolean {
  const separator = marker.indexOf('=');
  if (separator < 1) return false;
  const escapeRegex = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const name = escapeRegex(marker.slice(0, separator));
  const value = escapeRegex(
    marker.slice(separator + 1).replace(/^["']|["']$/g, '')
  );
  return new RegExp(`["']${name}["']\\s*:\\s*["']${value}["']`).test(source);
}

export function firstPostponedBoundaryOffset(html: string): number {
  const offsets = [html.indexOf('<!--$?-->'), html.indexOf('<!--$!-->')].filter(
    (offset) => offset >= 0
  );
  return offsets.length > 0 ? Math.min(...offsets) : -1;
}

export function hasHeroPreload(html: string, heroHint: string): boolean {
  const tags = html.match(/<link\b[^>]*>/gi) ?? [];
  return tags.some((tag) => {
    const attrs = new Map(
      [...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map(
        ([, key, value]) => [
          key?.toLowerCase(),
          value?.replaceAll('&amp;', '&'),
        ]
      )
    );
    return (
      attrs.get('rel')?.toLowerCase() === 'preload' &&
      attrs.get('as')?.toLowerCase() === 'image' &&
      (attrs.get('href') === heroHint ||
        [
          ...(attrs.get('imagesrcset') ?? '').matchAll(
            /(?:^|,\s*)(\S+?)\s+(?:\d+w|\d+(?:\.\d+)?x)(?=\s*(?:,|$))/g
          ),
        ].some((candidate) => candidate[1] === heroHint))
    );
  });
}

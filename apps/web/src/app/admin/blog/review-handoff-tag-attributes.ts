const MEDIA_ATTRIBUTE_PATTERN = /([\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;

export function tagAttributes(tag: string): { name: string; value: string }[] {
  // Attribute names are ASCII case-insensitive; values arrive unquoted so
  // callers compare raw text. A repeated attribute keeps its first
  // occurrence, mirroring the HTML parser (and the sanitizer): later
  // duplicates are parse errors the browser ignores.
  const seen = new Set<string>();
  const attributes: { name: string; value: string }[] = [];
  for (const match of tag.matchAll(MEDIA_ATTRIBUTE_PATTERN)) {
    const name = match[1].toLowerCase();
    if (seen.has(name)) continue;
    seen.add(name);
    const raw = match[2];
    attributes.push({
      name,
      value:
        raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw,
    });
  }
  return attributes;
}

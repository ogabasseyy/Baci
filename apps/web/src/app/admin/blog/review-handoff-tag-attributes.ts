const MEDIA_ATTRIBUTE_PATTERN = /([\w-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g;

export function tagAttributes(tag: string): { name: string; value: string }[] {
  // Attribute names are ASCII case-insensitive; values arrive unquoted so
  // callers compare raw text.
  return [...tag.matchAll(MEDIA_ATTRIBUTE_PATTERN)].map((match) => {
    const raw = match[2];
    return {
      name: match[1].toLowerCase(),
      value:
        raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw,
    };
  });
}

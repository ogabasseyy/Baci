export function getNormalizedVariantAttribute(
  attributes: Record<string, string> | null | undefined,
  keys: string[]
): string | undefined {
  if (!attributes) {
    return undefined;
  }

  for (const key of keys) {
    const matchedKey =
      key in attributes
        ? key
        : Object.keys(attributes).find(
            (attributeKey) => attributeKey.toLowerCase() === key.toLowerCase()
          );
    const value = matchedKey ? attributes[matchedKey] : undefined;
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return undefined;
}

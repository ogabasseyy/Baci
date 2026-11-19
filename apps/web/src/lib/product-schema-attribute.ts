export function getNormalizedVariantAttribute(
  attributes: Record<string, string> | null | undefined,
  keys: string[]
): string | undefined {
  if (!attributes) {
    return undefined;
  }

  for (const key of keys) {
    const matchedKeys = [
      key,
      ...Object.keys(attributes).filter(
        (attributeKey) =>
          attributeKey !== key &&
          attributeKey.toLowerCase() === key.toLowerCase()
      ),
    ];
    for (const matchedKey of matchedKeys) {
      const value = Object.hasOwn(attributes, matchedKey)
        ? attributes[matchedKey]
        : undefined;
      if (typeof value === 'string' && value.trim().length > 0)
        return value.trim();
    }
  }

  return undefined;
}

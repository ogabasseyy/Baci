import { getNormalizedVariantAttribute } from './product-schema-attribute';

export function getVariantSchemaSize(
  attributes: Record<string, string> | null | undefined
): string | undefined {
  const explicitSize = getNormalizedVariantAttribute(attributes, ['size']);
  if (explicitSize && Array.from(explicitSize).length <= 100) {
    return explicitSize;
  }

  const inferredParts = [
    getNormalizedVariantAttribute(attributes, ['storage']),
    getNormalizedVariantAttribute(attributes, ['ram']),
  ].filter(
    (value): value is string =>
      Boolean(value) && Array.from(value as string).length <= 100
  );

  if (inferredParts.length === 0) {
    return undefined;
  }

  const size = Array.from(new Set(inferredParts)).join(' / ');
  return Array.from(size).length <= 100 ? size : undefined;
}

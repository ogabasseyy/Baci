import { getNormalizedVariantAttribute } from './product-schema-attribute';

export function getVariantSchemaColor(
  attributes: Record<string, string> | null | undefined
): string | undefined {
  const color = getNormalizedVariantAttribute(attributes, ['color', 'colour']);
  return color && Array.from(color).length <= 100 ? color : undefined;
}

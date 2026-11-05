import { getNormalizedVariantAttribute } from './product-schema-attribute';

export function getVariantSchemaColor(
  attributes: Record<string, string> | null | undefined
): string | undefined {
  return getNormalizedVariantAttribute(attributes, ['color', 'colour']);
}

import { builderDesignCapabilityAdapter } from './builder-design-capability-adapter';

const savedScalarComponentTypes = new Set([
  'Button',
  'Features',
  'FAQ',
  'Footer',
  'Hero',
  'LegalSection',
  'Newsletter',
  'ProductGrid',
  'Testimonial',
  'Text',
]);

/**
 * Puck permits merchants to clear text inputs. Preview accepts those bounded
 * saved values, while the design-capability adapter remains strict for AI edits.
 */
export function isPreviewSavedScalarProp(
  componentType: string,
  property: string,
  value: unknown
): boolean {
  if (!savedScalarComponentTypes.has(componentType)) return false;

  const descriptor =
    builderDesignCapabilityAdapter.getCapability(componentType)?.props[
      property
    ];
  return (
    descriptor?.type === 'string' &&
    typeof value === 'string' &&
    (descriptor.maximumLength === undefined ||
      value.length <= descriptor.maximumLength)
  );
}

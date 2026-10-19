import {
  builderDesignCapabilities,
  builderDesignCapabilityAdapter,
} from '@baci/shared/contracts';

const capabilityProps = builderDesignCapabilities.components.flatMap(
  (capability) =>
    Object.entries(capability.props).map(
      ([property, descriptor]) =>
        [`${capability.componentType}.${property}`, descriptor] as const
    )
);

export const builderAiEnumProps = Object.fromEntries(
  capabilityProps.flatMap(([key, descriptor]) =>
    descriptor.enum ? [[key, descriptor.enum]] : []
  )
) as Record<string, readonly string[]>;

export const builderAiNumberRanges = Object.fromEntries(
  capabilityProps.flatMap(([key, descriptor]) =>
    descriptor.type === 'number' &&
    descriptor.minimum !== undefined &&
    descriptor.maximum !== undefined
      ? [
          [
            key,
            [descriptor.minimum, descriptor.maximum, descriptor.wholeNumber],
          ],
        ]
      : []
  )
) as Record<string, readonly [number, number, boolean?]>;

export function isBuilderAiPropValue(
  componentType: string,
  property: string,
  value: unknown
): boolean {
  return builderDesignCapabilityAdapter.isPropValue(
    componentType,
    property,
    value
  );
}

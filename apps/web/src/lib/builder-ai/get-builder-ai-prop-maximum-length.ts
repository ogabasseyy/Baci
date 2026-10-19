import { builderDesignCapabilityAdapter } from '@baci/shared/contracts';

export function getBuilderAiPropMaximumLength(
  componentType: string,
  property: string
): number | undefined {
  return builderDesignCapabilityAdapter.getCapability(componentType)?.props[
    property
  ]?.maximumLength;
}

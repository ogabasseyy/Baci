import {
  type BuilderDesignCapabilityManifest,
  builderDesignCapabilities,
} from '@baci/shared/contracts';
import { builderConfig } from '@/components/builder/config';
import { getBuilderAiPropMaximumLength } from './get-builder-ai-prop-maximum-length';

type ValidationOptions = {
  capabilities?: BuilderDesignCapabilityManifest;
  componentTypes?: string[];
};

export function validateBuilderDesignCapabilities(
  options: ValidationOptions = {}
): {
  classifiedComponentCount: number;
  renderableComponentCount: number;
  uncoveredComponentTypes: string[];
} {
  const capabilities = options.capabilities ?? builderDesignCapabilities;
  const componentTypes =
    options.componentTypes ?? Object.keys(builderConfig.components);
  const byType = new Map(
    capabilities.components.map((capability) => [
      capability.componentType,
      capability,
    ])
  );
  const uncoveredComponentTypes = componentTypes.filter(
    (componentType) => !byType.has(componentType)
  );

  if (uncoveredComponentTypes.length > 0) {
    throw new Error(
      `Missing builder design capability policy for ${uncoveredComponentTypes.join(', ')}.`
    );
  }

  for (const componentType of [
    'Features',
    'Footer',
    'Header',
    'Hero',
    'Newsletter',
    'ProductGrid',
    'Testimonial',
    'Text',
  ]) {
    const capability = byType.get(componentType);
    if (!capability) continue;
    for (const property of Object.keys(capability.props)) {
      const maximumLength = getBuilderAiPropMaximumLength(
        componentType,
        property
      );
      const descriptor = capability.props[property];
      if (
        maximumLength !== undefined &&
        descriptor.maximumLength !== maximumLength
      ) {
        throw new Error(
          `${componentType}.${property} capability limit differs from web validation.`
        );
      }
    }
  }

  for (const capability of capabilities.components) {
    const sharedCapability = builderDesignCapabilities.components.find(
      ({ componentType }) => componentType === capability.componentType
    );
    if (
      !sharedCapability ||
      JSON.stringify(capability) !== JSON.stringify(sharedCapability)
    ) {
      throw new Error(
        `${capability.componentType} capability differs from the shared design contract.`
      );
    }
  }

  return {
    classifiedComponentCount: capabilities.components.length,
    renderableComponentCount: capabilities.components.filter(
      ({ renderable }) => renderable
    ).length,
    uncoveredComponentTypes,
  };
}

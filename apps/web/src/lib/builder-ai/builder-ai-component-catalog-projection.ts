import {
  builderDesignCapabilities,
  builderDesignCapabilityAdapter,
} from '@baci/shared/contracts';
import { builderAiStructuredPropProjectionDetails } from './builder-ai-structured-prop-projection-details';
import { getBuilderAiPropShape } from './get-builder-ai-prop-shape';

export function getBuilderAiCatalogProjection() {
  return builderDesignCapabilities.components
    .filter(({ aiEditable }) => aiEditable)
    .map((capability) => {
      const defaults = builderDesignCapabilityAdapter.getDefaults(
        capability.componentType
      );
      return {
        componentType: capability.componentType,
        ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
        editableProps: Object.entries(capability.props).map(
          ([property, descriptor]) => ({
            name: property,
            shape: getBuilderAiPropShape(capability.componentType, property),
            ...(descriptor.enum ? { allowedValues: descriptor.enum } : {}),
            ...(descriptor.maximumLength
              ? { maximumLength: descriptor.maximumLength }
              : {}),
            ...(descriptor.minimum !== undefined
              ? { minimum: descriptor.minimum }
              : {}),
            ...(descriptor.maximum !== undefined
              ? { maximum: descriptor.maximum }
              : {}),
            ...(descriptor.wholeNumber ? { wholeNumber: true } : {}),
            ...(builderAiStructuredPropProjectionDetails[
              `${capability.componentType}.${property}`
            ] ?? {}),
          })
        ),
        insertable: capability.aiInsertable,
        placement: capability.placement,
        protected: capability.protected,
      };
    });
}

import {
  builderDesignCapabilities,
  builderDesignCapabilityAdapter,
} from '@baci/shared/contracts';

export type ComponentDefinition = {
  defaults?: Record<string, unknown>;
  editableProps: readonly string[];
  insertable?: boolean;
  protected?: boolean;
};

export const aiEditableComponents = Object.fromEntries(
  builderDesignCapabilities.components
    .filter(({ aiEditable }) => aiEditable)
    .map((capability) => {
      const defaults = builderDesignCapabilityAdapter.getDefaults(
        capability.componentType
      );
      return [
        capability.componentType,
        {
          ...(Object.keys(defaults).length > 0 ? { defaults } : {}),
          editableProps: Object.keys(capability.props),
          insertable: capability.aiInsertable,
          protected: capability.protected,
        },
      ];
    })
) as Record<string, ComponentDefinition>;

export type AiEditableComponentType = keyof typeof aiEditableComponents;

import { builderDesignCapabilities } from '@baci/shared/contracts';

/** Compatibility view. The shared design manifest is the capability source. */
export const COMPONENT_SCHEMA = Object.fromEntries(
  builderDesignCapabilities.components
    .filter((capability) => capability.aiEditable || capability.aiInsertable)
    .map((capability) => [
      capability.componentType,
      {
        description: capability.description,
        props: capability.props,
        ...(capability.specialOperations
          ? { specialOperations: capability.specialOperations }
          : {}),
      },
    ])
);

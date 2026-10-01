import {
  builderAiFeatureIconNames,
  builderDesignCapabilities,
} from '@baci/shared/contracts';

function projectMember(
  name: string,
  descriptor: {
    enum?: string[];
    maximumLength?: number;
    required?: boolean;
    type: string;
  }
) {
  return {
    name,
    ...(descriptor.enum
      ? { allowedValues: descriptor.enum }
      : descriptor.type === 'feature-icon'
        ? { allowedValues: builderAiFeatureIconNames }
        : {}),
    ...(descriptor.maximumLength
      ? { maximumLength: descriptor.maximumLength }
      : {}),
    required: descriptor.required === true,
    valueType:
      descriptor.type === 'safe-link' ? 'safe-storefront-url' : descriptor.type,
  };
}

export const builderAiStructuredPropProjectionDetails = Object.fromEntries(
  builderDesignCapabilities.components.flatMap((capability) =>
    Object.entries(capability.props).flatMap(([property, descriptor]) => {
      if (!descriptor.item) return [];
      return [
        [
          `${capability.componentType}.${property}`,
          {
            ...(descriptor.maximumItems
              ? { maximumItems: descriptor.maximumItems }
              : {}),
            members: Object.entries(descriptor.item.properties).map(
              ([name, member]) => projectMember(name, member)
            ),
            ...(descriptor.minimumItems
              ? { minimumItems: descriptor.minimumItems }
              : {}),
            ...(descriptor.item.uniqueBy
              ? { uniqueBy: descriptor.item.uniqueBy }
              : {}),
          },
        ],
      ];
    })
  )
) as Record<string, object>;

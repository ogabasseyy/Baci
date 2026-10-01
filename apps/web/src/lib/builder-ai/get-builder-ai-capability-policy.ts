import type { BuilderDesignCapabilityManifest } from '@baci/shared/contracts';

export function getBuilderAiCapabilityPolicy(
  manifest: BuilderDesignCapabilityManifest
) {
  return {
    allowedComponentTypes: manifest.components
      .filter(({ aiEditable }) => aiEditable)
      .map(({ componentType }) => componentType),
    capabilityVersion: manifest.capabilityVersion,
    refused: manifest.components.flatMap(
      ({ componentType, refused, refusal }) =>
        refused && refusal
          ? [
              {
                code: refusal.code,
                componentType,
                message: refusal.message,
              },
            ]
          : []
    ),
    themeTokenKeys: manifest.themeTokenKeys,
  };
}

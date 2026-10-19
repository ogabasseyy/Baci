import {
  type BuilderDesignCapabilityManifest,
  builderDesignCapabilities,
} from '@baci/shared/contracts';

function projectProps(
  manifest: BuilderDesignCapabilityManifest,
  componentType: string,
  operation: string
) {
  const props =
    manifest.components.find(
      (capability) => capability.componentType === componentType
    )?.specialOperations?.[operation] ?? {};
  return Object.fromEntries(
    Object.entries(props).map(([property, descriptor]) => [
      property,
      { ...descriptor },
    ])
  );
}

export function getBuilderAiSpecialOperationGuidance(
  manifest: BuilderDesignCapabilityManifest = builderDesignCapabilities
) {
  return {
    updateCarouselSlide: {
      ...projectProps(manifest, 'HeroCarousel', 'updateCarouselSlide'),
      mediaMutation: {
        message: manifest.refusalCodes['media-review'],
        refusalCode: 'media-review',
      },
    },
    updateRoot: { title: { maximumLength: 120 } },
  };
}

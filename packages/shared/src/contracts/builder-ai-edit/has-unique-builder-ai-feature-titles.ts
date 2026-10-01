export function hasUniqueBuilderAiFeatureTitles(
  features: readonly { title: string }[]
): boolean {
  return (
    new Set(features.map((feature) => feature.title)).size === features.length
  );
}

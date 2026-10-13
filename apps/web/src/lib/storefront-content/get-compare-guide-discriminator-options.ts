type CompareRequirementIdentifier = { identifier: string };

export function getCompareGuideDiscriminatorOptions(
  requirements: readonly CompareRequirementIdentifier[]
) {
  const hasDistinctIdentifiers =
    requirements.length > 1 &&
    new Set(requirements.map(({ identifier }) => identifier)).size ===
      requirements.length;
  return hasDistinctIdentifiers
    ? {
        allowPartialDiscriminatorGroups: true,
        allowMissingDiscriminatorGroups: true,
      }
    : {};
}

export function hasUniqueBuilderAiNavigationLabels(
  links: readonly { label: string; url: string }[]
): boolean {
  return new Set(links.map((link) => link.label)).size === links.length;
}

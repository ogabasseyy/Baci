import type { SupportedClusterCategory } from './content-cluster-types';

const LAPTOP_CATEGORIES = new Set<SupportedClusterCategory>([
  'gaming-laptops',
  'laptops',
]);
const HARDWARE_TIER_PATTERN =
  /^(?:coreultra\d+|rtx\d+|corei[3579]|i[3579]|\d{3,}(?:[uhtpkgfy]|h[rsx]))$/u;

/** Returns a stripped laptop CPU or GPU tier for variant-aware guide matching. */
export function getLaptopHardwareDiscriminatorTokens(
  tokens: string[],
  categorySlug: SupportedClusterCategory | undefined
) {
  if (!categorySlug || !LAPTOP_CATEGORIES.has(categorySlug)) {
    return [];
  }
  return Array.from(
    new Set(tokens.filter((token) => HARDWARE_TIER_PATTERN.test(token)))
  );
}

import { toTitleCase } from '@/lib/to-title-case';
import type { ContentClusterKind } from './content-cluster-types';

function formatBrandList(brands: string[]): string {
  const formatted = Array.from(
    new Set(brands.map(toTitleCase).filter(Boolean))
  );
  if (formatted.length === 0) return '';
  if (formatted.length === 1) return formatted[0] as string;
  if (formatted.length === 2) return `${formatted[0]} and ${formatted[1]}`;
  return `${formatted.slice(0, -1).join(', ')}, and ${formatted[formatted.length - 1]}`;
}

export function buildClusterContextSummary(input: {
  categoryName: string;
  kind: ContentClusterKind | null;
  brands: string[];
}): string {
  const category = input.categoryName.toLowerCase();
  const validBrands = Array.from(
    new Set(input.brands.map(toTitleCase).filter(Boolean))
  );

  if (validBrands.length >= 2) {
    const brandText = formatBrandList(validBrands);
    return `Compare ${brandText} verified prices, condition options, and specs in ${category}.`;
  }

  if (validBrands.length === 1) {
    return `Compare ${validBrands[0]} verified prices, condition grading, and key specs in ${category}.`;
  }

  if (input.kind === 'troubleshooting') {
    return `Need a replacement or upgrade? Compare verified prices, condition grading, and key specs across ${category}.`;
  }

  return `Compare verified prices, condition grading, and key specs across ${category}.`;
}

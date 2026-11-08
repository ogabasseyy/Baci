import type { ContentClusterKind } from './content-cluster-types';

function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

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

export function annotateCommerceBridgeLinks(
  links: Array<{ href: string; label: string; description?: string }>,
  categoryName: string
): Array<{ href: string; label: string; description: string }> {
  const category = categoryName.toLowerCase();
  return links.map((link) => {
    const existingDescription = link.description?.trim();
    if (existingDescription) {
      return {
        ...link,
        description: existingDescription,
      };
    }

    let description: string;
    if (link.href.includes('/best-under/')) {
      description =
        'Compare verified prices and in-stock options within this budget tier.';
    } else if (link.href.includes('/compare/')) {
      description =
        'Review side-by-side specifications, price difference, and buying fit.';
    } else {
      description = `Explore verified ${category} listings with condition and stock details.`;
    }
    return {
      ...link,
      description,
    };
  });
}

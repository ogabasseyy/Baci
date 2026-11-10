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

import { canonicalizeCommerceVariantAxis } from './canonicalize-commerce-variant-axis';

function getDeclarationKeys(source: unknown): string[] {
  if (Array.isArray(source)) {
    return source.flatMap((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        return [];
      }

      const record = entry as Record<string, unknown>;
      const key =
        typeof record.key === 'string'
          ? record.key
          : typeof record.param === 'string'
            ? record.param
            : typeof record.name === 'string'
              ? record.name
              : null;
      return key ? [key] : [];
    });
  }

  if (!source || typeof source !== 'object') {
    return [];
  }

  return Object.keys(source as Record<string, unknown>);
}

export function getCommerceVariantAxes(
  declaration: unknown,
  fallbackAxes: readonly string[] = []
): string[] {
  const normalizeAxes = (axes: readonly string[]) => {
    const seen = new Set<string>();
    return axes.flatMap((axis) => {
      const canonical = canonicalizeCommerceVariantAxis(axis);
      if (!canonical || seen.has(canonical)) {
        return [];
      }

      seen.add(canonical);
      return [canonical];
    });
  };
  const declaredAxes = normalizeAxes(getDeclarationKeys(declaration));
  const fallbackCommerceAxes = normalizeAxes(fallbackAxes);
  return [...new Set([...declaredAxes, ...fallbackCommerceAxes])];
}

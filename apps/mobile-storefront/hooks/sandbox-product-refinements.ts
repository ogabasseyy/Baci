import type { SearchSort } from '@baci/shared/lib';

const PROCESSOR_FAMILY_PATTERN =
  /(core ultra [579]|core i[3579]|ryzen [3579]|apple m[1-9][0-9]*|snapdragon x (?:elite|plus)|intel celeron|intel pentium)/g;

function readProcessorValues(specifications: unknown): string[] {
  if (Array.isArray(specifications)) {
    return specifications.flatMap((section) => {
      if (!section || typeof section !== 'object') return [];
      const items = (section as { items?: unknown }).items;
      if (!Array.isArray(items)) return [];
      return items.flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const entry = item as { label?: unknown; value?: unknown };
        if (
          typeof entry.label !== 'string' ||
          !['processor', 'cpu', 'chip'].includes(
            entry.label.trim().toLowerCase()
          ) ||
          (typeof entry.value !== 'string' && typeof entry.value !== 'number')
        ) {
          return [];
        }
        return [String(entry.value).toLowerCase()];
      });
    });
  }

  if (!specifications || typeof specifications !== 'object') return [];
  return Object.entries(specifications)
    .filter(
      ([label, value]) =>
        ['processor', 'cpu', 'chip'].includes(label.trim().toLowerCase()) &&
        (typeof value === 'string' || typeof value === 'number')
    )
    .map(([, value]) => String(value).toLowerCase());
}

function toProcessorFamily(match: string): string {
  if (match.startsWith('core i')) {
    return `Intel Core ${match.slice(5)}`;
  }
  if (match.startsWith('ryzen ')) {
    return `AMD ${match.replace(/\b\w/g, (letter) => letter.toUpperCase())}`;
  }
  if (match.startsWith('apple m')) {
    return `Apple ${match.slice(6).toUpperCase()}`;
  }
  if (match.startsWith('core ultra ')) {
    return `Intel ${match.replace(/\b\w/g, (letter) => letter.toUpperCase())}`;
  }
  return match.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Mirrors storefront_processor_family for the pinned sandbox table fallback. */
export function getSandboxProcessorFamily(specifications: unknown) {
  const families = new Set<string>();
  for (const value of readProcessorValues(specifications)) {
    for (const match of value.matchAll(PROCESSOR_FAMILY_PATTERN)) {
      families.add(toProcessorFamily(match[0]));
    }
  }
  return families.size === 1 ? [...families][0] : null;
}

export function sortSandboxProducts<T extends Record<string, unknown>>(
  products: T[],
  sort: SearchSort
): T[] {
  // The fallback has no search relevance score, so relevance uses newest order.
  const field =
    sort === 'price_asc' || sort === 'price_desc'
      ? 'price'
      : sort === 'popular'
        ? 'view_count'
        : 'created_at';
  const direction = sort === 'price_asc' ? 1 : -1;

  return [...products].sort((left, right) => {
    const leftValue = left[field];
    const rightValue = right[field];
    if (leftValue == null && rightValue != null) return 1;
    if (leftValue != null && rightValue == null) return -1;
    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      const difference = (leftValue - rightValue) * direction;
      if (difference) return difference;
    } else if (
      typeof leftValue === 'string' &&
      typeof rightValue === 'string'
    ) {
      const difference = leftValue.localeCompare(rightValue) * direction;
      if (difference) return difference;
    }
    return String(left.id ?? '').localeCompare(String(right.id ?? ''));
  });
}

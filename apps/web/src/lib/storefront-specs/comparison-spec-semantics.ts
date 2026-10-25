export const COMPARISON_CONFLICT_PREFIX =
  'Conflicting catalog values (verify): ';

const ALIASES: Record<string, string> = {
  'cpu gpu': 'CPU / GPU',
  'ssd storage': 'Storage',
  'internal storage': 'Storage',
  storage: 'Storage',
  'refresh rate': 'Refresh Rate',
  'ip rating': 'Water and dust resistance',
  durability: 'Water and dust resistance',
  'water dust resistance': 'Water and dust resistance',
  'water resistance': 'Water and dust resistance',
  'water and dust resistance': 'Water and dust resistance',
};

export function normalizeComparisonLabel(label: string): string {
  const key = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ALIASES[key] ?? label.trim();
}

export function isDecisionSpec(label: string): boolean {
  return !/^(?:id|product id|merchant id|canonical model|model|models|model numbers|part number|part numbers|sku|brand|category|condition|source|source policy|source url|source urls|updated at|created at|colors|colours|available colors|build|model family|configuration note|notes)$/.test(
    label.toLowerCase().replace(/[_-]/g, ' ').trim()
  );
}

export function isDocumentedComparisonValue(value: unknown): boolean {
  return (
    !String(value).startsWith(COMPARISON_CONFLICT_PREFIX) &&
    value !== null &&
    value !== undefined &&
    !/^(?:|—|-|unknown|not documented|not specified|n\/?a|not applicable)$/i.test(
      String(value).trim()
    )
  );
}

export function normalizeComparisonValue(value: unknown): string {
  // Normalize spacing and case, but never infer a better capability from prose.
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/×/g, 'x');
}

/** Canonicalize common public catalog type aliases while preserving custom types. */
export function canonicalizeDiscoveryProductType(value: string) {
  const canonical = value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('en-US')
    .replace(/[\s-]+/g, '_');

  if (['phone', 'phones', 'smartphone', 'smartphones'].includes(canonical)) {
    return 'phone';
  }
  if (['laptop', 'laptops'].includes(canonical)) return 'laptop';
  if (['tablet', 'tablets'].includes(canonical)) return 'tablet';
  return canonical;
}

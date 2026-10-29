function connectivityValues(
  attributes: Record<string, unknown> | null | undefined
): string[] {
  return Object.entries(attributes ?? {}).flatMap(([key, value]) => {
    const normalizedKey = key
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '_');
    return (normalizedKey === 'sim_type' || normalizedKey === 'connectivity') &&
      typeof value === 'string' &&
      value.trim()
      ? [value.trim()]
      : [];
  });
}

/** Only an explicit Wi-Fi-only value rules out a cellular option. */
export function isWifiOnlyConnectivity(
  attributes: Record<string, unknown> | null | undefined
): boolean {
  const values = connectivityValues(attributes);
  return (
    values.length > 0 &&
    values.every((value) => /^wi[\s-]*fi(?:[\s-]*only)?$/i.test(value))
  );
}

export function hasConnectivityValue(
  attributes: Record<string, unknown> | null | undefined
): boolean {
  return connectivityValues(attributes).length > 0;
}

export function normalizeStorefrontHeader(
  value: string | null
): string | undefined {
  return value?.trim().toLowerCase() || undefined;
}

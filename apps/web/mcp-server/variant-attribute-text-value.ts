/** Renders a variant attribute for human-readable summaries, dropping non-primitive JSON that would stringify as "[object Object]". Falsy primitives (0, false) are kept so text stays consistent with structured attributes. */
export function getMcpVariantAttributeTextValue(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return undefined;
  if (value === '' || (typeof value === 'number' && !Number.isFinite(value))) return undefined;
  return String(value);
}

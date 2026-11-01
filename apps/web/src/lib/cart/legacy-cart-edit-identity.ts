/** A confirmed offer ID disambiguates condition, but not options or attachments. */
export function hasUnsupportedLegacyEditIdentity(
  line: {
    variantId?: string | null;
    condition?: string | null;
    voucherToken?: string | null;
    voucherAwardId?: string | null;
    options?: Record<string, unknown> | null;
  },
  hasExactOffer: boolean
): boolean {
  return Boolean(
    line.variantId ||
      (!hasExactOffer && line.condition) ||
      line.voucherToken ||
      line.voucherAwardId ||
      Object.keys(line.options ?? {}).length
  );
}

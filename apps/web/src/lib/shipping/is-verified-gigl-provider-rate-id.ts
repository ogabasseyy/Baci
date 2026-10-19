/** Only canonical encoded booking selectors may establish service identity.
 * Legacy IDs omit centre/delivery/origin suffixes. Raw whitespace, unsafe
 * integers and enum values that the permissive carrier parser defaults fail.
 */
export function isVerifiedGiglProviderRateId(
  value: string | null | undefined
): value is string {
  return Boolean(
    value &&
      /^GIGL_[1-9]\d*_[01]_[0-3](?:_(?:0|[1-9]\d*)(?:_[01](?:_[1-9]\d*)?)?)?$/.test(
        value
      ) &&
      value
        .split('_')
        .slice(1)
        .every((part) => Number.isSafeInteger(Number(part)))
  );
}

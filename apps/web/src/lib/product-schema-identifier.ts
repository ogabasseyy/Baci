export function isValidMerchantIdentifier(
  value: string | null | undefined
): value is string {
  return Boolean(
    value && Array.from(value).length <= 50 && !/[\s\p{C}]/u.test(value)
  );
}

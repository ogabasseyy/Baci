/** Detect changes to the exact base RPC, excluding binding/unchecked siblings. */
export function definesOrPatchesStorefrontOrderRpc(sql: string): boolean {
  const name = String.raw`(?:(?:"public"|public)\s*\.\s*)?(?:"create_storefront_order"|create_storefront_order)`;
  return [
    new RegExp(
      String.raw`CREATE\s+OR\s+REPLACE\s+FUNCTION\s+${name}\s*\(`,
      'i'
    ),
    new RegExp(String.raw`pg_get_functiondef\s*\([^;]*${name}\s*\(`, 'i'),
    new RegExp(
      String.raw`EXECUTE\s+(?:format\s*\([^;]*${name}\s*\(|['"][^;]*${name}\s*\(|[^;]*CREATE\s+OR\s+REPLACE\s+FUNCTION\s+${name}\s*\()`,
      'i'
    ),
  ].some((pattern) => pattern.test(sql));
}

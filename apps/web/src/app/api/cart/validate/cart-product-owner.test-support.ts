export const CART_TEST_MERCHANT_ID = '77777777-7777-4777-8777-777777777777';
export function withCartProductOwners(rows: unknown[]): unknown[] {
  return rows.map((row) =>
    typeof row === 'object' && row !== null
      ? { merchant_id: CART_TEST_MERCHANT_ID, ...row }
      : row
  );
}

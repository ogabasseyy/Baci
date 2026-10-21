import type { CartErrorCode } from '@baci/shared/cart';
import { saveSharedCartImportReceipt } from './cart-storage';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

/** Complete tracked import operations and record the consumed source lines on the receipt. */
export function createImportFinisher(context: SharedCartRuntime) {
  const { dispatch, stateRef, generationRef, importOpIdsRef, optionsRef } =
    context;
  function finishImportOp(
    operationId: string,
    outcome: { ok: true } | { ok: false; code: CartErrorCode }
  ): void {
    const generation = generationRef.current;
    if (!importOpIdsRef.current.has(operationId)) return;
    importOpIdsRef.current.delete(operationId);
    if (!outcome.ok) {
      importOpIdsRef.current = new Set();
      dispatch({
        code: outcome.code,
        generation,
        type: 'import/failed',
      });
      return;
    }
    if (importOpIdsRef.current.size > 0) return;
    const current = stateRef.current;
    if (!current.confirmed) return;
    dispatch({
      generation,
      lineCount: current.confirmed.lines.length,
      snapshot: current.confirmed,
      type: 'import/finished',
    });
    saveSharedCartImportReceipt(optionsRef.current.merchantSlug, {
      cartId: current.confirmed.cartId,
      importedAt: new Date().toISOString(),
      lineCount: current.confirmed.lines.length,
      ...(context.importSourceIdsRef?.current.length
        ? {
            consumedCartItemIds: context.importSourceIdsRef.current.map(
              (line) => line.cartItemId
            ),
            consumedQuantities: Object.fromEntries(
              context.importSourceIdsRef.current.map((line) => [
                line.cartItemId,
                line.quantity,
              ])
            ),
          }
        : {}),
    });
  }
  return finishImportOp;
}

import type { CartErrorCode, CartSnapshot } from '@baci/shared/cart';
import { saveSharedCartImportReceipt } from './cart-storage';
import { consumedReceiptFields } from './shared-cart-storage';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

/** Complete tracked import operations and record the consumed source lines on the receipt. */
export function createImportFinisher(context: SharedCartRuntime) {
  const { dispatch, stateRef, generationRef, importOpIdsRef, optionsRef } =
    context;
  function finishImportOp(
    operationId: string,
    outcome:
      | { ok: true; snapshot?: CartSnapshot }
      | { ok: false; code: CartErrorCode }
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
    // The caller may hold the just-reconciled snapshot before
    // stateRef publishes it after the React commit; finish with that
    // snapshot instead of rolling back to the pre-command state.
    const confirmed = outcome.snapshot ?? current.confirmed;
    if (!confirmed) return;
    // The receipt counts imported source lines, not every line in
    // the confirmed snapshot (which may include pre-existing server
    // lines): the terminal filter consumes this count positionally
    // for receipts without consumed IDs.
    const importedLineCount =
      context.importSourceIdsRef?.current.length || confirmed.lines.length;
    dispatch({
      generation,
      lineCount: confirmed.lines.length,
      snapshot: confirmed,
      type: 'import/finished',
    });
    saveSharedCartImportReceipt(optionsRef.current.merchantSlug, {
      cartId: confirmed.cartId,
      importedAt: new Date().toISOString(),
      lineCount: importedLineCount,
      ...(context.importSourceIdsRef?.current.length
        ? consumedReceiptFields(context.importSourceIdsRef.current)
        : {}),
    });
  }
  return finishImportOp;
}

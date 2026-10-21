import type { CartSnapshot } from '@baci/shared/cart';
import { buildImportEntries } from './build-import-entries';
import { getSharedCartImportReceipt } from './cart-storage';
import type { CartItem } from './cart-types';
import { planLegacyImport } from './shared-cart-reducer';
import type { SharedCartRuntime } from './use-shared-cart-runtime';
export function importInitialDeviceCart(
  context: SharedCartRuntime,
  snapshot: CartSnapshot,
  cached: CartItem[],
  generation: number,
  isLive: () => boolean
): void {
  const { dispatch, stateRef, generationRef, importOpIdsRef, merchantSlug } =
    context;

  if (!isLive() || generationRef.current !== generation) return;
  if (
    stateRef.current.generation === generation &&
    stateRef.current.importStatus !== 'none' &&
    stateRef.current.importStatus !== 'failed'
  )
    return;
  const receipt = getSharedCartImportReceipt(merchantSlug);
  if (receipt?.cartId === snapshot.cartId) {
    dispatch({ generation, status: 'done', type: 'import/resolved' });
    return;
  }
  if (cached.length === 0) {
    dispatch({ generation, status: 'skipped', type: 'import/resolved' });
    return;
  }
  const planned = planLegacyImport(cached, snapshot, snapshot.cartId);
  if (planned.kind === 'nothing') {
    dispatch({ generation, status: 'skipped', type: 'import/resolved' });
    return;
  }
  if (planned.kind === 'blocked') {
    dispatch({ generation, type: 'import/capacity_exceeded' });
    return;
  }
  if (planned.kind === 'conflicts') {
    dispatch({
      conflicts: planned.conflicts,
      generation,
      type: 'import/conflicts',
    });
    return;
  }
  if (planned.kind === 'create') {
    // No server cart exists yet: the first sender pass creates with
    // these lines instead of queueing per-line adds.
    dispatch({
      generation,
      type: 'import/started',
      warnings: planned.warnings,
    });
    importOpIdsRef.current = new Set([planned.operationId]);
    return;
  }
  dispatch({
    generation,
    type: 'import/started',
    warnings: planned.warnings,
  });
  const entries = buildImportEntries(planned, snapshot.cartId);
  if (entries.length === 0) {
    dispatch({ generation, status: 'done', type: 'import/resolved' });
    return;
  }
  importOpIdsRef.current = new Set(entries.map((entry) => entry.operationId));
  dispatch({ entries, generation, type: 'import/enqueue' });
}

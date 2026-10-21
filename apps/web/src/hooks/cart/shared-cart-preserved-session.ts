import type { CartSnapshot } from '@baci/shared/cart';
import { buildImportEntries } from './build-import-entries';
import { getCartFromStorage, getSharedCartImportReceipt } from './cart-storage';
import { planLegacyImport } from './shared-cart-reducer';
import { isCartDeviceRevocationPending } from './shared-cart-session-revoke-client';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

/** Bootstrap can preserve a live cookie installed by another tab. */
export function adoptPreservedCart(
  runtime: SharedCartRuntime,
  snapshot: CartSnapshot
): boolean {
  if (isCartDeviceRevocationPending(runtime.optionsRef.current.merchantSlug))
    return false;
  const generation = runtime.generationRef.current;
  runtime.adoptOutcomeRef.current = 'session';
  runtime.dispatch({ generation, snapshot, type: 'link/snapshot' });
  const receipt = getSharedCartImportReceipt(
    runtime.optionsRef.current.merchantSlug
  );
  if (receipt?.cartId === snapshot.cartId) {
    runtime.dispatch({ generation, status: 'done', type: 'import/resolved' });
    return true;
  }
  const cachedLines = getCartFromStorage(
    runtime.optionsRef.current.merchantSlug
  );
  const plan = planLegacyImport(cachedLines, snapshot, snapshot.cartId);
  if (plan.kind === 'blocked') {
    runtime.dispatch({ generation, type: 'import/capacity_exceeded' });
  } else if (plan.kind === 'conflicts') {
    runtime.dispatch({
      generation,
      type: 'import/conflicts',
      conflicts: plan.conflicts,
    });
  } else if (plan.kind === 'commands') {
    runtime.dispatch({
      generation,
      type: 'import/started',
      warnings: plan.warnings,
    });
    const entries = buildImportEntries(plan, snapshot.cartId);
    runtime.importOpIdsRef.current = new Set(
      entries.map((entry) => entry.operationId)
    );
    if (runtime.importSourceIdsRef)
      runtime.importSourceIdsRef.current = cachedLines
        .map((item) => ({
          cartItemId: item.cartItemId,
          quantity: item.quantity,
        }))
        .filter((line) => Boolean(line.cartItemId));
    if (entries.length)
      runtime.dispatch({ generation, type: 'import/enqueue', entries });
    else
      runtime.dispatch({ generation, type: 'import/resolved', status: 'done' });
  } else {
    runtime.dispatch({
      generation,
      type: 'import/resolved',
      status: 'skipped',
    });
  }
  return true;
}

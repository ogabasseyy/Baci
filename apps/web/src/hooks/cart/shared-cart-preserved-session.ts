import type { CartSnapshot } from '@baci/shared/cart';
import { buildImportEntries } from './build-import-entries';
import { getCartFromStorage } from './cart-storage';
import { planLegacyImport } from './shared-cart-reducer';
import type { SharedCartRuntime } from './use-shared-cart-runtime';

/** Bootstrap can preserve a live cookie installed by another tab. */
export function adoptPreservedCart(
  runtime: SharedCartRuntime,
  snapshot: CartSnapshot
): void {
  const generation = runtime.generationRef.current;
  runtime.adoptOutcomeRef.current = 'session';
  runtime.dispatch({ generation, snapshot, type: 'link/snapshot' });
  const plan = planLegacyImport(
    getCartFromStorage(runtime.optionsRef.current.merchantSlug),
    snapshot,
    snapshot.cartId
  );
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
}

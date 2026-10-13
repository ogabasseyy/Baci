import 'server-only';
import { prefundedCardRuntimeSchemas } from '@/schemas/prefunded-card-runtime';
import { createPrefundedCardDispatcher } from './prefunded-card-dispatch';
import type { createPrefundedCardOperationStore } from './prefunded-card-operation-store';
import type { createPrefundedCardProvider } from './prefunded-card-provider';

type Store = ReturnType<typeof createPrefundedCardOperationStore>;
type Provider = ReturnType<typeof createPrefundedCardProvider>;

export function createPrefundedCardRuntime(input: {
  store: Store;
  provider: Provider;
  expectedSystemId: string;
}) {
  const system = prefundedCardRuntimeSchemas.systemIdentifier.parse(
    input.expectedSystemId
  );
  const dispatcher = createPrefundedCardDispatcher(input.store, input.provider);
  return async (operationId: string) => {
    const state = await input.store.readOperation(operationId, system);
    const requiresReconciliation =
      state.projectionStatus === 'reconciliation_required' ||
      state.collectionStatus === 'reversed' ||
      state.transferStatus === 'verified_failed' ||
      state.collectionStatus === 'action_required';
    const transferUnresolved = ['dispatching', 'pending', 'unknown'].includes(
      state.transferStatus
    );
    if (requiresReconciliation && !transferUnresolved)
      return { outcome: 'reconciliation_required' } as const;
    if (state.collectionStatus === 'verified_failed')
      return { outcome: 'collection_failed' } as const;
    if (
      state.collectionStatus === 'verified_success' &&
      state.transferStatus === 'verified_success'
    ) {
      return { outcome: await input.store.project(operationId, system) };
    }
    if (!requiresReconciliation && state.collectionStatus === 'not_started')
      return dispatcher.dispatchCollection(operationId, state.collectionFence);
    if (
      !requiresReconciliation &&
      state.collectionStatus === 'verified_success' &&
      state.transferStatus === 'not_started'
    ) {
      return dispatcher.dispatchTransfer(operationId, state.transferFence);
    }
    const claim = await input.store.claimReconciliation(operationId, 60);
    if (claim.outcome !== 'verify_only') return { outcome: 'pending' } as const;
    if (requiresReconciliation && claim.leg !== 'transfer')
      return { outcome: 'reconciliation_required' } as const;
    let verified: Awaited<ReturnType<Provider['verifyCollection']>>;
    try {
      verified = await (claim.leg === 'collection'
        ? input.provider.verifyCollection(claim.request)
        : input.provider.verifyTransfer(claim.request));
    } catch {
      return { outcome: 'pending' } as const;
    }
    if (verified.outcome === 'deferred') return { outcome: 'pending' } as const;
    if (verified.outcome === 'reconciliation_required') return verified;
    const result = await input.store.completeReconciliation(
      operationId,
      claim.token,
      claim.fence,
      claim.leg,
      verified.outcome,
      verified.evidence
    );
    return {
      outcome:
        requiresReconciliation || result === 'reconciliation_required'
          ? 'reconciliation_required'
          : 'pending',
    } as const;
  };
}

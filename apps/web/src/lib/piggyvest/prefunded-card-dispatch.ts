import 'server-only';
import type { createPrefundedCardOperationStore } from './prefunded-card-operation-store';

type Store = ReturnType<typeof createPrefundedCardOperationStore>;
type Provider = {
  submitCollection: (request: unknown) => Promise<{
    outcome: 'submitted_for_verification' | 'reconciliation_required';
  }>;
  submitTransfer: (request: unknown) => Promise<{
    outcome: 'submitted_for_verification' | 'reconciliation_required';
  }>;
};

export function createPrefundedCardDispatcher(
  store: Store,
  provider: Provider
) {
  return {
    async dispatchCollection(operationId: string, fence: number) {
      const claim = await store.claimCollection(operationId, fence);
      if (claim.outcome !== 'claimed') return claim;
      try {
        const result = await provider.submitCollection(claim.request);
        if (result.outcome === 'submitted_for_verification') return result;
        return store.recordCollection(
          operationId,
          claim.fence,
          'unknown',
          null
        );
      } catch {
        return store.recordCollection(
          operationId,
          claim.fence,
          'unknown',
          null
        );
      }
    },
    async dispatchTransfer(operationId: string, fence: number) {
      const claim = await store.claimTransfer(operationId, fence);
      if (claim.outcome !== 'claimed') return claim;
      try {
        const result = await provider.submitTransfer(claim.request);
        if (result.outcome === 'submitted_for_verification') return result;
        return store.recordTransfer(operationId, claim.fence, 'unknown', null);
      } catch {
        return store.recordTransfer(operationId, claim.fence, 'unknown', null);
      }
    },
  };
}

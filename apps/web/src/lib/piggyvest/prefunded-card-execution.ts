import 'server-only';
import { prefundedCardClaimedRequestSchema } from '@/schemas/prefunded-card-claimed-request';
import { prefundedCardProviderSchemas } from '@/schemas/prefunded-card-provider';
import { prefundedCardProviderEvidenceSchemas } from '@/schemas/prefunded-card-provider-evidence';
import { prefundedCardWorkerSchemas } from '@/schemas/prefunded-card-worker';
import { createPrefundedCardAuthorizationResolver } from './prefunded-card-authorization-resolver';
import { createPrefundedCardOperationStore } from './prefunded-card-operation-store';
import { createPrefundedCardProvider } from './prefunded-card-provider';
import { createPrefundedCardProviderEvidence } from './prefunded-card-provider-evidence';
import { createPrefundedCardReversalHandler } from './prefunded-card-reversal';
import { createPrefundedCardRuntime } from './prefunded-card-runtime';
import { createPrefundedCardWorker } from './prefunded-card-worker';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';

export function createPrefundedCardExecution(options: {
  worker: unknown;
  provider: unknown;
  evidence: unknown;
  execute: PiggyvestProvisioningExecutor;
  evidenceExecute: PiggyvestProvisioningExecutor;
  fetchImplementation: typeof fetch;
  resolveTransferOwnership?: (
    claim: ReturnType<typeof prefundedCardClaimedRequestSchema.parse>
  ) => Promise<unknown>;
}) {
  try {
    const worker = prefundedCardWorkerSchemas.scope.parse(options.worker);
    const provider = prefundedCardProviderSchemas.settings.parse(
      options.provider
    );
    const evidence = prefundedCardProviderEvidenceSchemas.configuration.parse(
      options.evidence
    );
    if (
      worker.integrationId !== provider.scope.integrationId ||
      worker.merchantId !== provider.scope.merchantId ||
      worker.treasuryBindingId !== provider.scope.treasuryBindingId ||
      worker.integrationId !== evidence.integrationId ||
      worker.businessId !== provider.piggyvest.expectedBusinessId ||
      worker.businessId !== evidence.piggyvest.expectedBusinessId ||
      worker.expectedSystemId !== evidence.systemIdentifier ||
      provider.piggyvest.apiSecret !== evidence.piggyvest.apiSecret ||
      provider.piggyvest.apiBaseUrl !== evidence.piggyvest.apiBaseUrl
    )
      throw new Error('Prefunded execution scope mismatch');
    const resolver = createPrefundedCardAuthorizationResolver({
      execute: options.execute,
      scope: {
        treasuryBindingId: provider.scope.treasuryBindingId,
        integrationId: worker.integrationId,
        merchantId: provider.scope.merchantId,
        systemIdentifier: worker.expectedSystemId,
      },
    });
    const storedEvidence = createPrefundedCardProviderEvidence({
      configuration: evidence,
      execute: options.evidenceExecute,
      fetchImplementation: options.fetchImplementation,
    });
    const store = createPrefundedCardOperationStore(options.execute);
    const adapters = createPrefundedCardProvider({
      settings: provider,
      fetchImplementation: options.fetchImplementation,
      resolveSavedMethod: resolver.resolveSavedMethod,
      verifyStoredTransfer: storedEvidence.verifyTransfer,
      expectedSystemIdentifier: worker.expectedSystemId,
      resolveTransferOwnership: options.resolveTransferOwnership,
    });
    const reconcileReversal = createPrefundedCardReversalHandler({
      execute: options.execute,
      expectedSystemId: worker.expectedSystemId,
      settings: provider,
      fetchImplementation: options.fetchImplementation,
      resolveSavedMethod: resolver.resolveSavedMethod,
    });
    const run = createPrefundedCardRuntime({
      store,
      provider: {
        ...adapters,
        verifyCollection: async (input: unknown) => {
          const result = await adapters.verifyCollection(input);
          if (result.outcome === 'reconciliation_required') {
            const claim = prefundedCardClaimedRequestSchema.parse(input);
            await reconcileReversal(
              claim.operationId,
              `verification:${claim.operationId}`
            );
          }
          return result;
        },
      },
      expectedSystemId: worker.expectedSystemId,
    });
    return Object.assign(
      createPrefundedCardWorker({
        configuration: worker,
        execute: options.execute,
        run,
      }),
      { reconcileReversal }
    );
  } catch {
    throw new Error('Prefunded execution unavailable');
  }
}

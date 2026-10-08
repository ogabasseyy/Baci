import 'server-only';
import { piggyvestProvisioningRecoverySchemas as schemas } from '@/schemas/piggyvest-provisioning-recovery';
import { createPiggyvestProvisioningRecoveryStore } from './provisioning-recovery-store';
import type { PiggyvestProvisioningExecutor } from './provisioning-store.types';
import { requestPiggyvestStagingJson } from './staging-json-request';

type RecoveryStatus =
  | 'not_ready'
  | 'storage_unavailable'
  | 'not_found'
  | 'completed'
  | 'stale'
  | 'ownership_unverified'
  | 'wallet_mismatch'
  | 'wallet_not_active'
  | 'lookup_unavailable'
  | 'missing_reference'
  | 'mapping_conflict';

export async function recoverPiggyvestProvisioning({
  configuration,
  scope,
  execute,
  fetchImplementation,
}: {
  configuration: unknown;
  scope: unknown;
  execute: PiggyvestProvisioningExecutor;
  fetchImplementation: typeof fetch;
}): Promise<{ status: RecoveryStatus }> {
  const parsed = schemas.clientConfiguration.safeParse(configuration);
  const identity = schemas.scope.safeParse(scope);
  if (
    !parsed.success ||
    !identity.success ||
    typeof execute !== 'function' ||
    typeof fetchImplementation !== 'function'
  ) {
    return { status: 'not_ready' };
  }
  const config = parsed.data;
  const store = createPiggyvestProvisioningRecoveryStore({
    configuration: config.storage,
    execute,
  });
  try {
    const recovered = await store.read(identity.data);
    if (!recovered) return { status: 'not_found' };
    if (!recovered.provider_wallet_id) {
      return { status: await store.observe(identity.data, null) };
    }
    const verification =
      recovered.status === 'awaiting_confirmation'
        ? await store.begin(identity.data)
        : null;
    if (
      verification &&
      verification.provider_wallet_id !== recovered.provider_wallet_id
    ) {
      return { status: 'storage_unavailable' };
    }
    if (verification?.completed) return { status: 'completed' };
    let observation: ReturnType<typeof schemas.observation.parse> | null = null;
    try {
      const response = await requestPiggyvestStagingJson({
        configuration: config.wallet,
        path: `/api/v1/wallet/${encodeURIComponent(recovered.provider_wallet_id)}`,
        method: 'GET',
        fetchImplementation,
      });
      observation = schemas.response.parse(response).data;
    } catch {
      observation = null;
    }
    if (!verification || !observation) {
      return { status: await store.observe(identity.data, observation) };
    }
    return {
      status: await store.confirm(
        identity.data,
        verification.verification_token,
        observation
      ),
    };
  } catch {
    return { status: 'storage_unavailable' };
  }
}

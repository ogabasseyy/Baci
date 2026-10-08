import 'server-only';
import { primaryCardCustodyLaunchSchemas as schemas } from '@/schemas/primary-wallet-card-custody-launch';
import { readPrimaryCardCustodyInboxRuntime } from './primary-wallet-card-custody-inbox-runtime';
import { createPrimaryCardCustodyLaunchBinding } from './primary-wallet-card-custody-launch-binding';
import { createPrimaryCardCustodySignedRuntime } from './primary-wallet-card-custody-signed-runtime';

export async function runPrimaryCardCustodyLaunch(input: {
  mode: 'readiness' | 'once';
  environment: NodeJS.ProcessEnv;
  readBinding: (path: string) => Promise<Uint8Array>;
  fetchImplementation: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
}) {
  const env = input.environment;
  if (
    env.PIGGYVEST_PRIMARY_CARD_TRANSFER_PASSWORD ||
    env.PIGGYVEST_PRIMARY_CARD_INTAKE_PASSWORD
  )
    throw new Error('Worker credential profile unavailable');
  const config = readPrimaryCardCustodyInboxRuntime(
    env,
    (input.now ?? Date.now)()
  );
  if (!config || config.transfer || config.signedInbox.batchSize !== 1)
    throw new Error('Worker configuration unavailable');
  const approval = schemas.approval.parse({
    approved: env.PIGGYVEST_PRIMARY_CARD_WORKER_APPROVED,
    path: env.PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE,
    sha256: env.PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE_SHA256,
    signature: env.PIGGYVEST_PRIMARY_CARD_CROSSWALK_FILE_SIGNATURE,
    issuerKey: env.PIGGYVEST_PRIMARY_CARD_CROSSWALK_DELIVERY_KEY,
  });
  const { signedInbox: _signedInbox, ...custodyConfig } = config;
  const resolveAuthenticatedCrosswalk = createPrimaryCardCustodyLaunchBinding({
    rawBytes: await input.readBinding(approval.path),
    approval,
    configuration: custodyConfig,
    now: input.now,
  });
  const runtime = createPrimaryCardCustodySignedRuntime({
    ...input,
    resolveAuthenticatedCrosswalk,
  });
  const readiness = await runtime.readiness();
  if (!readiness.ready)
    throw new Error('Worker database capability unavailable');
  const bindingReadiness = {
    crosswalkSelection: 'operation_records_only' as const,
    reusableBindingReady: false as const,
    autonomousFundingReady: false as const,
    missingProviderContract:
      'exhaustive_bank_and_internal_transaction_aliases' as const,
  };
  if (input.mode === 'readiness')
    return {
      status: 'storage_and_binding_ready' as const,
      claimsMade: false,
      providerRequestsMade: false,
      receiptProofRequired: true,
      ...bindingReadiness,
    };
  return {
    status: 'batch_finished' as const,
    ...(await runtime.runWorker(input.signal)),
    fundingComplete: false as const,
    ...bindingReadiness,
  };
}

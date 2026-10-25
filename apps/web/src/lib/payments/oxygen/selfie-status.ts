import 'server-only';
import { oxygenKycSchema } from '@/schemas/oxygen-runtime';
import { oxygenRuntimeSnapshotSchema } from '@/schemas/oxygen-runtime-view';
import type { OxygenProvider } from './provider';
import {
  type OxygenRuntimeRpc,
  oxygenRuntimeRpc,
  readOxygenSnapshot,
} from './runtime-service';

/** Read only: never reconciles or retires an uncertain NIN command. */
export async function readOxygenSelfieStatus(
  user: OxygenRuntimeRpc,
  workerClient: () => Promise<OxygenRuntimeRpc>,
  provider: OxygenProvider,
  partnerReference: string,
  workflowId: string
) {
  const current = await readOxygenSnapshot(user, workflowId);
  if (
    !current.executionEnabled ||
    !current.state.validated ||
    !current.state.selfieUrl ||
    current.state.bookingReference
  )
    throw new Error('Selfie unavailable');
  const worker = await workerClient();
  const scoped = oxygenRuntimeSnapshotSchema.parse(
    await oxygenRuntimeRpc(worker, 'worker_status', workflowId)
  );
  if (
    !scoped.executionEnabled ||
    scoped.workflowId !== current.workflowId ||
    scoped.state.applicationReference !== current.state.applicationReference ||
    !scoped.state.applicationReference ||
    !scoped.state.validated ||
    scoped.state.bookingReference
  )
    throw new Error('Selfie unavailable');
  const kyc = oxygenKycSchema.parse(
    await provider.call('kyc', {
      loan_request_reference: scoped.state.applicationReference,
      partner_reference: partnerReference,
    })
  );
  return {
    confirmed: kyc.selfie_status === 'DONE',
    checkedAt: new Date().toISOString(),
  };
}

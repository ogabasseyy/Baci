import 'server-only';
import {
  encryptOxygenResponse,
  type OxygenObservedResponse,
  projectOxygenResponse,
} from './response-evidence';
import type { OxygenRuntimeRpc } from './runtime-service';
export function createOxygenPaymentRecoveryRecorder(
  worker: OxygenRuntimeRpc,
  workflow: string,
  command: string,
  key: string,
  hosts: ReadonlySet<string>
) {
  if (!/^[a-f0-9]{64}$/i.test(key))
    throw new Error('Recovery evidence unavailable');
  let sequence = 0;
  return async (response: OxygenObservedResponse) => {
    ++sequence;
    const ciphertext = encryptOxygenResponse(
      projectOxygenResponse(response, hosts),
      key,
      workflow,
      command,
      sequence
    );
    const result = await worker.rpc('oxygen_payment_recovery', {
      p_operation: 'evidence',
      p_workflow_id: workflow,
      p_payload: { commandId: command, sequence, ciphertext },
    });
    if (result.error) throw new Error('Recovery evidence unavailable');
  };
}

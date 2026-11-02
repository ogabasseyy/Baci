import 'server-only';
import {
  type OxygenProviderDiagnostic,
  oxygenProviderDiagnosticSchema,
} from '@/schemas/oxygen-provider-diagnostic';
import type { OxygenRuntimeRpc } from './runtime-service';

export async function recordOxygenFailure(
  worker: OxygenRuntimeRpc,
  commandId: string,
  workflowId: string,
  stage: string,
  outcome: 'failed' | 'indeterminate',
  diagnostic: OxygenProviderDiagnostic
): Promise<void> {
  try {
    const recorded = await worker.rpc('oxygen_finish_failure', {
      p_command_id: commandId,
      p_outcome: outcome,
      p_stage: stage,
      p_diagnostic: oxygenProviderDiagnosticSchema.parse(diagnostic),
    });
    if (!recorded.error) return;
  } catch {
    // A lost persistence response is also uncertain; never replay a provider mutation.
  }
  // Static fallback plus correlation IDs only; never log the DB/provider error.
  console.error('oxygen_failure_evidence_write_failed', {
    commandId,
    workflowId,
  });
  throw new Error('Provider result requires reconciliation');
}

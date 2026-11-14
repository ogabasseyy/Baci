import 'server-only';
import { z } from 'zod';
import { oxygenProviderDiagnosticSchema } from '@/schemas/oxygen-provider-diagnostic';
import type { OxygenRuntimeRpc } from './runtime-service';

const timestamp = z.iso.datetime({ offset: true });
const row = z
  .object({
    commandId: z.uuid(),
    workflowId: z.uuid(),
    orderId: z.uuid(),
    action: z.string().max(64),
    status: z.enum(['failed', 'indeterminate']),
    startedAt: timestamp.nullable(),
    completedAt: timestamp.nullable(),
    applicationReference: z.uuid().nullable(),
    bookingReference: z.uuid().nullable(),
    recordedAt: timestamp,
    expiresAt: timestamp,
    diagnostic: oxygenProviderDiagnosticSchema,
  })
  .strict();
export type OxygenErrorReportRow = z.infer<typeof row>;
export async function readOxygenErrorReport(
  worker: OxygenRuntimeRpc,
  workflowId: string
): Promise<OxygenErrorReportRow[]> {
  z.uuid().parse(workflowId);
  const result = await worker.rpc('oxygen_error_report', {
    p_workflow_id: workflowId,
  });
  if (result.error) throw new Error('Error report unavailable for this worker');
  return z.array(row).max(100).parse(result.data);
}

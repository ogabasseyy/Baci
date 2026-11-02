import z from 'zod';

/** The jsonb returned by piggyvest_approvals.approve_ops_request(). */
export const opsDecisionResultSchema = z
  .strictObject({
    request_id: z.uuid(),
    decision: z.enum(['approve', 'reject']),
    approvals: z.int().nonnegative(),
    state: z.enum(['open', 'rejected']),
  })
  .transform((result) => ({
    requestId: result.request_id,
    decision: result.decision,
    approvals: result.approvals,
    state: result.state,
  }));

export type OpsDecisionResult = z.output<typeof opsDecisionResultSchema>;

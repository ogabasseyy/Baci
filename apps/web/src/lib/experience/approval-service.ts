import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const id = z.uuid();
const approval = z.strictObject({
  approvalId: id,
  merchantId: id,
  buildId: id,
  evidenceId: id,
  effectDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expectedVersion: z.number().int().nonnegative(),
  expiresAt: z.iso.datetime({ offset: true }),
  status: z.literal('confirmation-required'),
});
/** Owner-web only: normal authenticated client, never an MCP input/dispatcher. */
export async function loadDraftApproval(
  client: SupabaseClient,
  approvalId: string
) {
  id.parse(approvalId);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw Error('NOT_FOUND');
  const result = await client.rpc('experience_load_draft_approval', {
    p_intent: approvalId,
  });
  if (result.error) throw Error('APPROVAL_UNAVAILABLE');
  return z
    .union([
      approval,
      z.strictObject({
        status: z.literal('applied'),
        approvalId: id,
        merchantId: id,
        buildId: id,
        version: z.number().int().positive(),
      }),
    ])
    .parse(result.data);
}
/** Kept distinct from requestDraftApply: client approval flags confer no authority. */
export async function confirmDraftApply(
  client: SupabaseClient,
  approvalId: string
) {
  id.parse(approvalId);
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw Error('NOT_FOUND');
  // SQL reconciles committed effects before checking consumed/stale approval.
  // A preflight load here would incorrectly reject response-loss replay.
  const result = await client.rpc('experience_confirm_draft_apply', {
    p_intent: approvalId,
  });
  if (result.error) throw Error('CONFIRMATION_UNAVAILABLE');
  return z
    .strictObject({ buildId: id, version: z.number().int().positive() })
    .parse(result.data);
}

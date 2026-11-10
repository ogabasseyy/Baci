import type { SupabaseClient } from '@supabase/supabase-js';
import {
  experienceDraftApplyResult,
  experienceDraftApprovalResult,
} from '@/schemas/experience-draft-approval';
import { experienceApprovalId } from '@/schemas/experience-publication';

/** Owner-web only: normal authenticated client, never an MCP input/dispatcher. */
export async function loadDraftApproval(
  client: SupabaseClient,
  approvalId: string
) {
  experienceApprovalId.parse(approvalId);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw Error('NOT_FOUND');
  const result = await client.rpc('experience_load_draft_approval', {
    p_intent: approvalId,
  });
  if (result.error) throw Error('APPROVAL_UNAVAILABLE');
  return experienceDraftApprovalResult.parse(result.data);
}
/** Kept distinct from requestDraftApply: client approval flags confer no authority. */
export async function confirmDraftApply(
  client: SupabaseClient,
  approvalId: string
) {
  experienceApprovalId.parse(approvalId);
  const auth = await client.auth.getUser();
  if (auth.error || !auth.data.user) throw Error('NOT_FOUND');
  // SQL reconciles committed effects before checking consumed/stale approval.
  // A preflight load here would incorrectly reject response-loss replay.
  const result = await client.rpc('experience_confirm_draft_apply', {
    p_intent: approvalId,
  });
  if (result.error) throw Error('CONFIRMATION_UNAVAILABLE');
  return experienceDraftApplyResult.parse(result.data);
}

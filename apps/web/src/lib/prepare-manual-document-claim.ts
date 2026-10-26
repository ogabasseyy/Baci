import type { SupabaseClient } from '@supabase/supabase-js';
import {
  assertManualDocumentClaimMatchesOrder,
  type ManualDocumentClaimOrderSnapshot,
  type ManualDocumentCreatedClaim,
  manualDocumentClaimSchema,
} from '@/schemas/manual-order-document-claim';

interface ClaimRow {
  id: string;
  claim_owner: string;
  merchant_id: string;
}

export interface ManualDocumentClaimToken {
  token: string;
  tokenHash: string;
}

export type PreparedManualDocumentClaim =
  | {
      status: 'ready';
      prepared: ManualDocumentCreatedClaim;
      claim: ManualDocumentClaimToken;
      customDomain: string | null;
    }
  | { status: 'skipped'; reason: string };

/**
 * Claims the receipt link for a manual send and resolves the merchant's
 * custom claim domain. A malformed claim payload or an unavailable claim
 * skips (later triggers re-arm) instead of throwing into retries.
 *
 * The claim token is created by the sender, which owns the allow-listed
 * receipt-claim-links import — this helper stays clear of the credential
 * authority so the event-pipeline boundary contract holds.
 */
export async function prepareManualDocumentClaim(input: {
  supabase: SupabaseClient;
  row: ClaimRow;
  order: ManualDocumentClaimOrderSnapshot;
  recipientEmail: string;
  claim: ManualDocumentClaimToken;
  claimDomain: string | null;
}): Promise<PreparedManualDocumentClaim> {
  const { supabase, row, order, recipientEmail, claim, claimDomain } = input;
  const { data, error } = await supabase.rpc(
    'create_manual_order_document_claim',
    {
      p_outbox_id: row.id,
      p_claim_owner: row.claim_owner,
      p_token_hash: claim.tokenHash,
    }
  );
  if (error) throw new Error('Could not prepare manual document access');
  const preparedParsed = manualDocumentClaimSchema.safeParse(data);
  if (!preparedParsed.success)
    return { status: 'skipped', reason: 'claim_validation_failed' };
  const prepared = preparedParsed.data;
  if (prepared.status !== 'created')
    return { status: 'skipped', reason: 'document_claim_unavailable' };
  assertManualDocumentClaimMatchesOrder(prepared, order, recipientEmail);
  // The claim domain arrives in the snapshot: no second domains read, so
  // the claim URL cannot disagree with the snapshot the mark compares.
  return { status: 'ready', prepared, claim, customDomain: claimDomain };
}

/**
 * Records the accepted mail's token as known-delivered on every
 * post-acceptance path, so later rotations cannot orphan the link.
 */
export async function recordManualDocumentAcceptedToken(input: {
  supabase: SupabaseClient;
  claimId: string;
  merchantId: string;
  mailedTokenHash: string;
}): Promise<boolean> {
  const { data: markedClaimId, error: markError } = await input.supabase.rpc(
    'mark_manual_document_claim_sent',
    {
      p_claim_id: input.claimId,
      p_merchant_id: input.merchantId,
      p_mailed_token_hash: input.mailedTokenHash,
    }
  );
  return !markError && markedClaimId === input.claimId;
}

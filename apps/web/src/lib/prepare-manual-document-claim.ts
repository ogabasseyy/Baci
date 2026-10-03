import type { SupabaseClient } from '@supabase/supabase-js';
import { createReceiptClaimToken } from '@/lib/import-notifications/receipt-claim-links';
import { resolveManualDocumentClaimDomain } from '@/lib/resolve-manual-document-claim-domain';
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

type ClaimToken = ReturnType<typeof createReceiptClaimToken>;

export type PreparedManualDocumentClaim =
  | {
      status: 'ready';
      prepared: ManualDocumentCreatedClaim;
      claim: ClaimToken;
      customDomain: string | null;
    }
  | { status: 'skipped'; reason: string };

/**
 * Claims the receipt link for a manual send and resolves the merchant's
 * custom claim domain. A malformed claim payload or an unavailable claim
 * skips (later triggers re-arm) instead of throwing into retries.
 */
export async function prepareManualDocumentClaim(input: {
  supabase: SupabaseClient;
  row: ClaimRow;
  order: ManualDocumentClaimOrderSnapshot;
  recipientEmail: string;
}): Promise<PreparedManualDocumentClaim> {
  const { supabase, row, order, recipientEmail } = input;
  const claim = createReceiptClaimToken();
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
  const customDomain = await resolveManualDocumentClaimDomain(
    supabase,
    row.merchant_id
  );
  return { status: 'ready', prepared, claim, customDomain };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import 'server-only';
import {
  getRedvaultCheckoutSummary,
  type RedvaultCheckoutSummary,
} from './get-redvault-checkout-summary';

type RedvaultDraftRow = {
  id: string;
  proof_context: Record<string, unknown>;
  quote_payload_hash: string;
  quote_version_id: string;
};

function firstRow(value: unknown): RedvaultDraftRow | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (
    !row ||
    typeof row !== 'object' ||
    typeof (row as RedvaultDraftRow).id !== 'string' ||
    !(row as RedvaultDraftRow).proof_context ||
    typeof (row as RedvaultDraftRow).proof_context !== 'object' ||
    typeof (row as RedvaultDraftRow).quote_payload_hash !== 'string' ||
    typeof (row as RedvaultDraftRow).quote_version_id !== 'string'
  ) {
    return null;
  }
  return row as RedvaultDraftRow;
}

export async function createRedvaultOrderDraft({
  client,
  createProof,
  draftArgs,
}: {
  client: SupabaseClient;
  createProof: (draft: {
    id: string;
    proofContext: Record<string, unknown>;
    quotePayloadHash: string;
    quoteVersionId: string;
  }) => object;
  draftArgs: Record<string, unknown>;
}): Promise<{
  id: string;
  quotePayloadHash: string;
  quoteVersionId: string;
  summary: RedvaultCheckoutSummary;
}> {
  const { data: draftData, error: draftError } = await client.rpc(
    'create_storefront_redvault_order_draft' as never,
    draftArgs as never
  );
  const draft = firstRow(draftData);
  if (draftError || !draft) {
    throw new Error(
      draftError?.message ?? 'Unable to create REDVAULT order draft'
    );
  }

  const { data: attachData, error: attachError } = await client.rpc(
    'attach_storefront_redvault_discount_proof' as never,
    {
      p_proof: createProof({
        id: draft.id,
        proofContext: draft.proof_context,
        quotePayloadHash: draft.quote_payload_hash,
        quoteVersionId: draft.quote_version_id,
      }),
      p_order_id: draft.id,
      p_quote_payload_hash: draft.quote_payload_hash,
      p_quote_version_id: draft.quote_version_id,
    } as never
  );
  if (attachError) {
    throw new Error(attachError.message);
  }
  const attached = Array.isArray(attachData) ? attachData[0] : attachData;
  if (attached?.status !== 'pending')
    throw new Error('redvault_attachment_not_pending');
  const summary = await getRedvaultCheckoutSummary({
    client,
    orderId: draft.id,
  });

  return {
    id: draft.id,
    quotePayloadHash: draft.quote_payload_hash,
    quoteVersionId: draft.quote_version_id,
    summary,
  };
}

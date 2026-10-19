import type { StoreRpc } from './replay-store';
import { replayPrefundedSchemas } from './schemas/replay-prefunded';
import { replaySignatureLookupSchema } from './schemas/replay-signature-reader';

export function createReplaySignatureReader(store: StoreRpc) {
  return async (input: unknown) => {
    const lookup = replaySignatureLookupSchema.safeParse(input);
    if (!lookup.success) throw new Error('Invalid receipt signature lookup');
    const scope = lookup.data;
    let response: unknown;
    try {
      response = await store.call<unknown>(
        'read_piggyvest_staging_receipt_signature',
        {
          p_receipt_id: scope.receiptId,
          p_payload_sha256: scope.payloadSha256,
          p_claim_token: scope.claimToken,
        }
      );
    } catch {
      throw new Error('Receipt signature lookup unavailable');
    }
    const parsed = replayPrefundedSchemas.originalSignature.safeParse(response);
    if (!parsed.success) throw new Error('Invalid receipt signature response');
    const receipt = parsed.data;
    if (
      receipt &&
      (receipt.receiptId !== scope.receiptId ||
        receipt.payloadSha256 !== scope.payloadSha256)
    )
      throw new Error('Receipt signature identity mismatch');
    return receipt;
  };
}

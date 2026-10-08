import 'server-only';
import { createHash } from 'node:crypto';
import { preparePrimaryWalletInflowReceipt } from './primary-wallet-inflow-receipt';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

type Receipt = ReturnType<typeof preparePrimaryWalletInflowReceipt>;
type Outcome = 'credited' | 'duplicate' | 'unmapped' | 'conflict';
interface Input {
  rawBody: Uint8Array;
  signature: string | null;
  secret: string | undefined;
  apply: (receipt: Receipt & { bodyDigest: string }) => Promise<Outcome>;
}

export async function applyPrimaryWalletSignedInflow(
  input: Input
): Promise<Outcome> {
  if (
    input.rawBody.byteLength === 0 ||
    input.rawBody.byteLength > 65536 ||
    !verifyPiggyvestPayloadSignature({
      payload: input.rawBody,
      signature: input.signature,
      secret: input.secret,
    })
  ) {
    throw new Error('Wallet inflow authentication failed');
  }
  let receipt: Receipt;
  try {
    const json: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody)
    );
    receipt = preparePrimaryWalletInflowReceipt(json);
  } catch {
    throw new Error('Invalid wallet inflow receipt');
  }
  try {
    const outcome = await input.apply({
      ...receipt,
      bodyDigest: createHash('sha256').update(input.rawBody).digest('hex'),
    });
    if (!['credited', 'duplicate', 'unmapped', 'conflict'].includes(outcome))
      throw new Error('Invalid outcome');
    return outcome;
  } catch {
    throw new Error('Wallet inflow reconciliation unavailable');
  }
}

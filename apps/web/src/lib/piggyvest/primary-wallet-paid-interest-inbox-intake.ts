import 'server-only';
import { readPrimaryWalletPaidInterestInboxRuntime } from './primary-wallet-paid-interest-inbox-runtime';
import { createPrimaryWalletPaidInterestInboxStore } from './primary-wallet-paid-interest-inbox-store';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

export async function dispatchPrimaryWalletPaidInterestInbox(input: {
  rawBody: Uint8Array;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const config = readPrimaryWalletPaidInterestInboxRuntime('intake', input.env);
  if (!config) return 'disabled' as const;
  const rawBody = Uint8Array.from(input.rawBody);
  // HMAC hex is case-insensitive. Canonicalize its textual representation at
  // the durable intake boundary; rawBody remains the exact signed byte stream.
  const signature = input.signature?.toLowerCase() ?? null;
  if (
    !rawBody.byteLength ||
    rawBody.byteLength > 65536 ||
    ![config.webhookSecret, ...(config.retainedWebhookSecrets ?? [])].some(
      (secret) =>
        verifyPiggyvestPayloadSignature({
          payload: rawBody,
          signature,
          secret,
        })
    )
  )
    return 'invalid_signature' as const;
  return await createPrimaryWalletPaidInterestInboxStore(config).enqueue({
    rawHex: Buffer.from(rawBody).toString('hex'),
    signature: signature ?? '',
  });
}

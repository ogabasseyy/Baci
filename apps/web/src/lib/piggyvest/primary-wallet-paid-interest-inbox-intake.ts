import 'server-only';
import { primaryWalletPaidInterestSchemas as schemas } from '@/schemas/primary-wallet-paid-interest';
import { readPrimaryWalletPaidInterestInboxRuntime } from './primary-wallet-paid-interest-inbox-runtime';
import { createPrimaryWalletPaidInterestInboxStore } from './primary-wallet-paid-interest-inbox-store';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

export async function dispatchPrimaryWalletPaidInterestInbox(input: {
  rawBody: Uint8Array;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const config = readPrimaryWalletPaidInterestInboxRuntime(input.env);
  if (!config) return 'disabled' as const;
  const rawBody = Uint8Array.from(input.rawBody);
  if (
    !rawBody.byteLength ||
    rawBody.byteLength > 65536 ||
    ![config.webhookSecret, ...(config.retainedWebhookSecrets ?? [])].some(
      (secret) =>
        verifyPiggyvestPayloadSignature({
          payload: rawBody,
          signature: input.signature,
          secret,
        })
    )
  )
    return 'invalid_signature' as const;
  try {
    schemas.event.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody))
    );
  } catch {
    return 'invalid_payload' as const;
  }
  return await createPrimaryWalletPaidInterestInboxStore(config).enqueue({
    rawHex: Buffer.from(rawBody).toString('hex'),
    signature: input.signature ?? '',
  });
}

import 'server-only';
import { primaryWalletPaidInterestInboxSchemas as schemas } from '@/schemas/primary-wallet-paid-interest-inbox';
import { readPrimaryWalletPaidInterestInboxRuntime } from './primary-wallet-paid-interest-inbox-runtime';
import { createPrimaryWalletPaidInterestInboxStore } from './primary-wallet-paid-interest-inbox-store';
import {
  normalizePiggyvestSignature,
  verifyPiggyvestPayloadSignature,
} from './verify-piggyvest-payload-signature';
import {
  acceptedWebhookSecrets,
  familyArchivedSecrets,
  type WebhookKeyScope,
} from './webhook-key-archive';

export async function dispatchPrimaryWalletPaidInterestInbox(input: {
  rawBody: Uint8Array;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
  /** `replay` also accepts this family's archived keys past their overlap. */
  keyScope?: WebhookKeyScope;
}) {
  const config = readPrimaryWalletPaidInterestInboxRuntime('intake', input.env);
  if (!config) return 'disabled' as const;
  const rawBody = Uint8Array.from(input.rawBody);
  const signature = normalizePiggyvestSignature(input.signature);
  if (
    !rawBody.byteLength ||
    rawBody.byteLength > 65536 ||
    !signature ||
    !acceptedWebhookSecrets(
      config,
      familyArchivedSecrets(
        'interest',
        input.env ?? process.env,
        new Date(),
        input.keyScope ?? 'ingress'
      )
    ).some((secret) =>
      verifyPiggyvestPayloadSignature({
        payload: rawBody,
        signature,
        secret,
      })
    )
  )
    return 'invalid_signature' as const;
  try {
    schemas.envelope.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(rawBody))
    );
  } catch {
    return 'invalid_payload' as const;
  }
  return await createPrimaryWalletPaidInterestInboxStore(config).enqueue({
    rawHex: Buffer.from(rawBody).toString('hex'),
    signature,
  });
}

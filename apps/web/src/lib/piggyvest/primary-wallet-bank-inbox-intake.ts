import 'server-only';
import { NextResponse } from 'next/server';
import { readPrimaryWalletBankInboxRuntime } from './primary-wallet-bank-inbox-runtime';
import { createPrimaryWalletBankInboxStore } from './primary-wallet-bank-inbox-store';
import { preparePrimaryWalletInflowReceipt } from './primary-wallet-inflow-receipt';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

export async function dispatchPrimaryWalletBankInboxIntake(input: {
  rawBody: Uint8Array;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
}) {
  const headers = { 'Cache-Control': 'no-store' };
  try {
    const config = readPrimaryWalletBankInboxRuntime('intake', input.env);
    if (!config) return { outcome: 'disabled' as const, response: null };
    if (!input.rawBody.byteLength || input.rawBody.byteLength > 65536)
      throw new Error('Invalid envelope');
    if (
      ![config.webhookSecret, ...(config.retainedWebhookSecrets ?? [])].some(
        (secret) =>
          verifyPiggyvestPayloadSignature({
            payload: input.rawBody,
            signature: input.signature,
            secret,
          })
      )
    )
      throw new Error('Invalid signature');
    const event: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody)
    );
    preparePrimaryWalletInflowReceipt(event);
    if (!input.signature) throw new Error('Missing signature');
    const store = createPrimaryWalletBankInboxStore(config);
    await store.readiness();
    const outcome = await store.enqueue({
      rawHex: Buffer.from(input.rawBody).toString('hex'),
      signature: input.signature,
    });
    if (outcome === 'not_handled') return { outcome, response: null };
    return {
      outcome,
      response: NextResponse.json(
        {
          received: true,
          bankQueued: outcome !== 'conflict',
          quarantined: outcome === 'conflict',
          duplicate: outcome === 'duplicate',
        },
        { status: 200, headers }
      ),
    };
  } catch {
    return {
      outcome: 'unavailable' as const,
      response: NextResponse.json(
        {
          error: 'Primary bank receipt intake unavailable',
          code: 'PRIMARY_BANK_INBOX_UNAVAILABLE',
        },
        { status: 503, headers }
      ),
    };
  }
}

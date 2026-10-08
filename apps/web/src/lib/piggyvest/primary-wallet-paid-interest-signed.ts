import 'server-only';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import { primaryWalletPaidInterestSchemas as schemas } from '@/schemas/primary-wallet-paid-interest';
import { verifyPiggyvestPayloadSignature } from './verify-piggyvest-payload-signature';

type Selection = z.infer<typeof schemas.selection>;
type Proof = z.infer<typeof schemas.proof>;

export async function applyPrimaryWalletSignedPaidInterest(input: {
  rawBody: Uint8Array;
  signature: string | null;
  configuration: unknown;
  resolveCrosswalk: (selection: Selection) => Promise<unknown>;
  retrieveWallet: (walletId: string) => Promise<unknown>;
  apply: (proof: Proof) => Promise<unknown>;
  now?: () => Date;
}): Promise<z.infer<typeof schemas.outcome>> {
  const config = schemas.runtime.parse(input.configuration);
  if (
    input.rawBody.byteLength === 0 ||
    input.rawBody.byteLength > 65536 ||
    !verifyPiggyvestPayloadSignature({
      payload: input.rawBody,
      signature: input.signature,
      secret: config.webhookSecret,
    })
  )
    throw new Error('Primary paid-interest authentication failed');
  let event: z.infer<typeof schemas.event>;
  try {
    event = schemas.event.parse(
      JSON.parse(
        new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody)
      )
    );
    const breakdown = event.eventData.break_down;
    if (
      breakdown.gross_interest_payout - breakdown.withholding_tax !==
        breakdown.net_interest_payout ||
      event.eventData.amount !== breakdown.net_interest_payout
    )
      throw new Error('Invalid arithmetic');
  } catch {
    throw new Error('Primary paid-interest receipt invalid');
  }
  const selection = schemas.selection.parse({
    webhookCustomerId: event.customer_id,
    sourceWalletId: event.pvb_wallet,
    accruedWalletId: event.pvb_accrued_interest_wallet,
    destinationWalletId: event.eventData.destination_wallet,
    envelopeDestinationWalletId: event.pvb_destination_wallet,
  });
  try {
    const crosswalkValue = await input.resolveCrosswalk(selection);
    if (crosswalkValue === null) return 'prerequisite';
    const crosswalk = schemas.crosswalk.parse(crosswalkValue);
    if (
      crosswalk.integrationId !== config.integrationId ||
      crosswalk.environment !== config.environment ||
      crosswalk.businessId !== config.businessId ||
      Object.entries(selection).some(
        ([field, value]) => crosswalk[field as keyof Selection] !== value
      )
    )
      return 'prerequisite';
    const parsedWallet = schemas.wallet.safeParse(
      await input.retrieveWallet(crosswalk.apiWalletId)
    );
    if (!parsedWallet.success) return 'prerequisite';
    const wallet = parsedWallet.data.data;
    if (
      wallet.id !== crosswalk.apiWalletId ||
      wallet.business_id !== config.businessId ||
      wallet.api_customer_id !== crosswalk.apiCustomerId
    )
      return 'prerequisite';
    const detail = event.eventData;
    const proof = schemas.proof.parse({
      ...selection,
      payoutId: detail.id,
      reference: detail.reference,
      envelopeReference: event.pvb_reference,
      batchId: detail.batch_id,
      paidAt: new Date(detail.timestamp).toISOString(),
      amountKobo: detail.amount,
      grossKobo: detail.break_down.gross_interest_payout,
      taxKobo: detail.break_down.withholding_tax,
      netKobo: detail.break_down.net_interest_payout,
      currency: wallet.currency,
      crosswalkId: crosswalk.id,
      apiWalletId: wallet.id,
      apiCustomerId: wallet.api_customer_id,
      businessId: wallet.business_id,
      eventId: event.eventId,
      bodyDigest: createHash('sha256').update(input.rawBody).digest('hex'),
      observedAt: (input.now?.() ?? new Date()).toISOString(),
    });
    return schemas.outcome.parse(await input.apply(proof));
  } catch {
    throw new Error('Primary paid-interest reconciliation unavailable');
  }
}

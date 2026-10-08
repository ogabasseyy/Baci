import 'server-only';
import { NextResponse } from 'next/server';
import { dispatchPrimaryWalletPaidInterest } from './primary-wallet-paid-interest-dispatch';
import { dispatchPrimaryWalletPaidInterestInbox } from './primary-wallet-paid-interest-inbox-intake';

export async function primaryInterestWebhookResponse(input: {
  rawBody: Uint8Array;
  signature: string | null;
}): Promise<NextResponse | null> {
  const receipt = await dispatchPrimaryWalletPaidInterestInbox(input);
  if (receipt !== 'disabled') {
    const durable = ['accepted', 'duplicate', 'quarantined'].includes(receipt);
    return NextResponse.json(
      durable
        ? receipt === 'quarantined'
          ? { received: true, quarantined: true }
          : {
              received: true,
              interestQueued: true,
              duplicate: receipt === 'duplicate',
            }
        : {
            received: false,
            code: 'PIGGYVEST_INTEREST_RECONCILIATION_PENDING',
          },
      { status: durable ? 200 : 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  const outcome = await dispatchPrimaryWalletPaidInterest(input);
  if (outcome === 'disabled') return null;
  if (outcome === 'credited' || outcome === 'duplicate') {
    return NextResponse.json(
      { received: true, duplicate: outcome === 'duplicate' },
      { status: 200, headers: { 'Cache-Control': 'no-store' } }
    );
  }
  return NextResponse.json(
    { received: false, code: 'PIGGYVEST_INTEREST_RECONCILIATION_PENDING' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } }
  );
}

import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import type { WalletPayRuntime } from '@/lib/piggyvest/wallet-pay-runtime';
import { walletPayScope } from '@/lib/piggyvest/wallet-pay-scope';
import type { imeiWalletPaySchemas } from '@/schemas/imei-wallet-pay';
import { hashImei, type ImeiLookupRow } from '../route-helpers';
import {
  lookupPriceKobo,
  WalletPaymentMismatchError,
} from './deliver-paid-imei-lookup';
import { normalizeForLookup } from './normalize-for-lookup';

type Identity = { merchantId: string; customerId: string; userId: string };
type Scope = ReturnType<typeof walletPayScope>;
type PayAnswer = { status: 'pin_refused'; reason: string } | { status: string };

export interface PayImeiWalletPaymentDeps {
  readRuntime: () => WalletPayRuntime | null;
  readRecoveryRuntime: () => WalletPayRuntime;
  resolveIdentity: (runtime: WalletPayRuntime) => Promise<Identity | null>;
  hashSalt: () => string | undefined;
  readLookup: (
    identity: Identity,
    lookupId: string
  ) => Promise<ImeiLookupRow | null>;
  check: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    operationId: string;
  }) => Promise<{
    purpose: string;
    purchaseRef: string;
    amountKobo: number;
  } | null>;
  pay: (input: {
    runtime: WalletPayRuntime;
    scope: Scope;
    operationId: string;
    pinProof: string;
  }) => Promise<PayAnswer>;
  deliver: (input: {
    runtime: WalletPayRuntime;
    identity: Identity;
    lookup: ImeiLookupRow;
    operationId: string;
    normalizedImei: string;
    payment: { purpose: string; purchaseRef: string; amountKobo: number };
  }) => Promise<Response>;
}

const NO_STORE = { 'Cache-Control': 'no-store' };
const refuse = (error: string, code: string, status: number) =>
  NextResponse.json({ error, code }, { status, headers: NO_STORE });
const accepted = (status: string, operationId: string) =>
  NextResponse.json(
    { status, operationId },
    { status: 202, headers: { 'Cache-Control': 'no-store' } }
  );

/** The HTTP answer for every payment outcome except a confirmed one. */
function payResponse(result: PayAnswer, operationId: string) {
  if (result.status === 'pin_refused')
    return 'reason' in result && result.reason === 'missing'
      ? refuse(
          'Please confirm your PIN to continue.',
          'PIN_PROOF_REQUIRED',
          400
        )
      : refuse(
          'Please confirm your PIN again to continue.',
          'PIN_PROOF_REFUSED',
          403
        );
  switch (result.status) {
    case 'insufficient':
      return refuse(
        'Your PiggyVest wallet can not cover this check.',
        'INSUFFICIENT_FUNDS',
        409
      );
    case 'pending':
      return accepted('payment_pending', operationId);
    case 'needs_review':
      return accepted('payment_review', operationId);
    case 'refunding':
      return accepted('payment_refunding', operationId);
    case 'released':
    case 'expired':
      return refuse(
        'This payment did not go through. Please start again.',
        'PAYMENT_NOT_COMPLETED',
        409
      );
    case 'conflict':
      return refuse('Please refresh and try again.', 'PAYMENT_CONFLICT', 409);
    default:
      return refuse(
        'Could not confirm your PiggyVest wallet. Please try again later.',
        'WALLET_UNAVAILABLE',
        503
      );
  }
}

/**
 * IMEI check paid from the PiggyVest wallet, step 2 (and every status
 * re-check): spend the PIN proof and send the payment once, then deliver the
 * lookup when the payment is confirmed. Re-posting with an empty proof never
 * sends money: the database ignores the proof for any payment past 'issued'.
 */
export async function payImeiWalletPayment(
  input: {
    lookupId: string;
    body: z.infer<typeof imeiWalletPaySchemas.payRequest>;
    auth: unknown;
  },
  deps: PayImeiWalletPaymentDeps
): Promise<Response> {
  const { lookupId, body } = input;
  const live = deps.readRuntime();
  if (body.pinProof !== '' && !live)
    return refuse(
      'Paying from your PiggyVest wallet is not available right now.',
      'PIGGYVEST_PAY_UNAVAILABLE',
      503
    );
  const runtime = live ?? deps.readRecoveryRuntime();
  const identity = await deps.resolveIdentity(runtime);
  if (!identity)
    return refuse(
      'Finish setting up your PiggyVest wallet to pay from it.',
      'PIGGYVEST_WALLET_NOT_READY',
      409
    );
  const lookup = await deps.readLookup(identity, lookupId);
  if (!lookup) return refuse('IMEI check not found.', 'LOOKUP_NOT_FOUND', 404);
  const salt = deps.hashSalt();
  // Only a new spend or a new delivery hashes the IMEI: a finished lookup's
  // status check answers without the salt (Codex P2).
  if (!salt && (body.pinProof !== '' || lookup.status === 'pending'))
    return refuse(
      'IMEI lookup is temporarily unavailable.',
      'IMEI_HASH_SALT_MISSING',
      503
    );
  // The same normalisation and hash the IMEI route used to create the lookup.
  // A mismatch blocks spending a new PIN and delivery, never a status check:
  // money already sent still settles, and an undeliverable payment is refunded
  // by the wallet pay drain.
  // A lookup on a tier that no longer exists can not be matched: treated as
  // a mismatch (money already sent still settles, then the drain refunds).
  const normalizedImei = normalizeForLookup(body.imei, lookup);
  const matches =
    normalizedImei !== null &&
    !!salt &&
    hashImei(normalizedImei, salt) === lookup.imei_hash;
  const mismatch = () =>
    refuse(
      'This IMEI does not match the check you paid for.',
      'IMEI_MISMATCH',
      409
    );
  if (!matches && body.pinProof !== '') return mismatch();
  const scope = walletPayScope(runtime, identity);
  const payment = await deps.check({
    runtime,
    scope,
    operationId: body.operationId,
  });
  if (
    payment?.purpose !== 'imei_check' ||
    payment.purchaseRef !== lookupId ||
    payment.amountKobo !== lookupPriceKobo(lookup)
  )
    return refuse(
      'This payment is not for this IMEI check.',
      'PAYMENT_OPERATION_INVALID',
      409
    );
  const result = await deps.pay({
    runtime,
    scope,
    operationId: body.operationId,
    pinProof: body.pinProof,
  });
  if (result.status !== 'confirmed')
    return payResponse(result, body.operationId);
  // A finished lookup answers with its own saved result (no new delivery
  // needs the IMEI), even if the IMEI hash salt rotated since (Codex P1).
  const finished = lookup.status !== 'pending';
  if (!finished && (!matches || normalizedImei === null)) return mismatch();
  try {
    return await deps.deliver({
      runtime,
      identity,
      lookup,
      operationId: body.operationId,
      normalizedImei: normalizedImei ?? '',
      payment,
    });
  } catch (error) {
    // Found only after the payment was confirmed: money moved, so never
    // "nothing was taken" (Muse). Under review; the drain refunds it.
    if (error instanceof WalletPaymentMismatchError)
      return NextResponse.json(
        { status: 'payment_review', operationId: body.operationId },
        { status: 202, headers: { 'Cache-Control': 'no-store' } }
      );
    throw error;
  }
}

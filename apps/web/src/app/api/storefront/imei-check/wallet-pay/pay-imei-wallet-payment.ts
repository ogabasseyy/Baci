import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import {
  type WalletPayAnswer,
  walletPayRefuse,
  walletPayResponse,
} from '@/lib/piggyvest/wallet-pay-http';
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
type PayAnswer = WalletPayAnswer;

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
    /** The delivery state: refund_owed / refunded once it was refunded. */
    fulfilment?: string;
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

const refuse = walletPayRefuse;

const payResponse = (result: PayAnswer, operationId: string) =>
  walletPayResponse(result, operationId, 'check');

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
  // A finished lookup answers with its own saved result (no new delivery
  // needs the IMEI), even if the IMEI hash salt rotated since (Codex P1).
  const finished = lookup.status !== 'pending';
  // Only a pending lookup (a new spend or a new delivery) hashes the IMEI: a
  // finished one answers without the salt, PIN proof or not (Codex P2).
  if (!salt && !finished)
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
  if (!matches && body.pinProof !== '' && !finished) return mismatch();
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
  // A finished lookup never takes a new payment: a replacement issued while an older
  // attempt's refund was being cached is not charged once the lookup has
  // finished; its saved outcome answers instead (Codex P1).
  // An empty-proof re-check still reconciles (it never sends money).
  let current = lookup;
  if (!finished || body.pinProof === '') {
    let result: PayAnswer;
    try {
      result = await deps.pay({
        runtime,
        scope,
        operationId: body.operationId,
        pinProof: body.pinProof,
      });
    } catch (error) {
      // The database refuses to reserve a payment for a lookup that finished
      // after it was read (serialised with saving the result; nothing was
      // spent or sent): the saved result answers (Codex P1). Anything else,
      // or a lookup still pending, is unknown: the route says check again.
      const fresh = await deps.readLookup(identity, lookupId);
      if (!fresh || fresh.status === 'pending') throw error;
      current = fresh;
      result = { status: 'confirmed' };
    }
    if (result.status !== 'confirmed')
      return payResponse(result, body.operationId);
  }
  // A payment already refunded (e.g. by the drain after the IMEI salt or the
  // tier changed) ends without the IMEI: delivery caches its refunded
  // outcome, so the lookup never stays pending (Codex P2).
  const refunded =
    payment.fulfilment === 'refund_owed' || payment.fulfilment === 'refunded';
  if (
    current.status === 'pending' &&
    !refunded &&
    (!matches || normalizedImei === null)
  )
    return mismatch();
  try {
    return await deps.deliver({
      runtime,
      identity,
      lookup: current,
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

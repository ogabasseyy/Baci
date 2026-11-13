import {
  IMEI_SERVICE_TIERS,
  type ImeiDeviceCategory,
  type ImeiServiceTierKey,
} from '@baci/shared/imei';
import { z } from 'zod';
import type {
  WalletPayAdapter,
  WalletPayFailedReason,
  WalletPayOutcome,
  WalletPayPayAnswer,
} from '@/components/wallet-pay/wallet-pay.types';
import { ImeiCheckApiResponseSchema, type ImeiResult } from '@/lib/validation';
import {
  imeiWalletPayApi,
  type WalletPayConnection,
  type WalletPayReply,
} from '@/lib/wallet-pay/imei-wallet-pay-api';

export type ImeiWalletPayResult = {
  result: ImeiResult;
  lookupId: string | null;
  tier: ImeiServiceTierKey;
};

const issued = z.object({
  status: z.enum(['payment_required', 'payment_pending', 'payment_review']),
  lookupId: z.uuid(),
  operationId: z.uuid(),
  amountKobo: z.number().int().positive(),
});

const codeOf = (reply: WalletPayReply) =>
  typeof reply.body.code === 'string' ? reply.body.code : '';
const outcome = (
  kind: WalletPayOutcome['kind'],
  failedReason?: WalletPayFailedReason
) => ({
  kind: 'outcome' as const,
  outcome: failedReason ? { kind, failedReason } : { kind },
});

/** Answers every step can give before any money moves. */
function refusal(reply: WalletPayReply) {
  const code = codeOf(reply);
  if (reply.httpStatus === 401 || code === 'UNAUTHORIZED')
    return outcome('sign_in');
  if (
    code.startsWith('PIGGYVEST_PAY_UNAVAILABLE') ||
    code === 'PIGGYVEST_WALLET_NOT_READY' ||
    code === 'PIN_UNAVAILABLE'
  )
    return outcome('unavailable');
  if (code === 'INSUFFICIENT_FUNDS') return outcome('insufficient');
  if (code === 'PAYMENT_NOT_COMPLETED' || code === 'PAYMENT_OPERATION_INVALID')
    return outcome('not_completed');
  return null;
}

function delivered(
  reply: WalletPayReply,
  tier: ImeiServiceTierKey
): { kind: 'delivered'; result: ImeiWalletPayResult } | null {
  const parsed = ImeiCheckApiResponseSchema.safeParse(reply.body);
  if (reply.httpStatus !== 200 || !parsed.success) return null;
  if (!parsed.data.success || !parsed.data.data) return null;
  return {
    kind: 'delivered',
    result: {
      result: parsed.data.data,
      lookupId: parsed.data.lookupId ?? null,
      tier,
    },
  };
}

/** Maps a pay (or re-check) answer. Money may have moved: unknown = pending. */
export function imeiPayAnswer(
  reply: WalletPayReply,
  tier: ImeiServiceTierKey,
  /** An empty-proof re-check: the payment may already have been sent. */
  recheck = false
): WalletPayPayAnswer<ImeiWalletPayResult> {
  const result = delivered(reply, tier);
  if (result) return result;
  if (reply.body.refund === 'piggyvest_wallet') return outcome('refunded');
  const status = reply.body.status;
  if (reply.httpStatus === 202) {
    if (status === 'payment_refunding') return outcome('refunded');
    if (status === 'payment_review') return outcome('review');
    return outcome('pending');
  }
  const code = codeOf(reply);
  if (code === 'PIN_PROOF_REQUIRED' || code === 'PIN_PROOF_REFUSED')
    return { kind: 'pin_again', message: 'Please enter your PIN again.' };
  // With a proof the mismatch comes before any transfer (nothing taken); on a
  // re-check the payment may already be confirmed, so it is under review
  // (the drain refunds a paid check nobody can collect).
  if (code === 'IMEI_MISMATCH')
    return recheck ? outcome('review') : outcome('failed', 'imei_mismatch');
  // On a re-check only the payment record's own end states (short of money,
  // released or expired, refunded) can say nothing was taken; a mismatched
  // operation says nothing about it, so keep confirming.
  if (recheck && code === 'PAYMENT_OPERATION_INVALID')
    return {
      kind: 'outcome',
      outcome: { kind: 'pending', maybePaid: true },
    };
  const refused = refusal(reply);
  // A lost session or a pause says nothing about a payment already sent.
  if (
    refused &&
    (refused.outcome.kind === 'sign_in' ||
      refused.outcome.kind === 'unavailable')
  )
    return {
      kind: 'outcome',
      outcome: { kind: refused.outcome.kind, maybePaid: true },
    };
  return refused ?? outcome('pending');
}

/**
 * The IMEI check's wallet pay steps. One Idempotency-Key per sheet, so a
 * retried start finds the same lookup and payment instead of a new one.
 */
export function createImeiWalletPayAdapter(input: {
  connection: WalletPayConnection;
  device: ImeiDeviceCategory;
  tier: ImeiServiceTierKey;
  imei: string;
  idempotencyKey: string;
  /** The server can't take this tier from the PiggyVest wallet. */
  onTierRefused?: () => void;
}): WalletPayAdapter<ImeiWalletPayResult> {
  let lookupId: string | null = null;
  const { connection, tier, imei } = input;
  return {
    async start() {
      const reply = await imeiWalletPayApi.start(connection, input);
      if (codeOf(reply) === 'PIGGYVEST_PAY_UNAVAILABLE_FOR_TIER')
        input.onTierRefused?.();
      const payment = issued.safeParse(reply.body);
      if (reply.httpStatus === 202 && payment.success) {
        lookupId = payment.data.lookupId;
        const { operationId, amountKobo } = payment.data;
        // Never ask a PIN for more than the price this screen showed: a
        // larger issued amount is refused before any money moves (Muse).
        // A lower one (an older lookup's recorded price) is fine.
        const shownKobo = Math.round(IMEI_SERVICE_TIERS[tier].price * 100);
        if (payment.data.status === 'payment_required')
          return amountKobo > shownKobo
            ? outcome('failed', 'price_changed')
            : { kind: 'pin', operationId, amountKobo };
        // Pending or under review: keep the operation and check on it, so
        // a payment PiggyVest confirms later still delivers the check.
        return { kind: 'recheck', operationId, amountKobo };
      }
      // A replayed start: the purchase already finished (its result or its
      // refund), or its delivery is still running. None of these is a
      // failure before payment.
      // An accepted (202) answer we can't read is an unknown: keep
      // confirming (the start runs again with the same key), never 'failed'.
      if (reply.httpStatus === 202) return outcome('pending');
      const replayed = delivered(reply, tier);
      if (replayed) return replayed;
      if (reply.body.refund === 'piggyvest_wallet') return outcome('refunded');
      if (codeOf(reply) === 'IDEMPOTENT_REQUEST_IN_FLIGHT')
        return outcome('pending');
      // A server error may come after the lookup and its payment were
      // created: keep the key (a start never moves money) and try again.
      const refused = refusal(reply);
      if (refused) return refused;
      return reply.httpStatus >= 500
        ? outcome('not_started')
        : outcome('failed');
    },
    async verifyPin(operationId, pin) {
      if (!lookupId) return outcome('failed');
      const reply = await imeiWalletPayApi.verifyPin(connection, {
        lookupId,
        operationId,
        pin,
      });
      const proof = z
        .object({ proof: z.string().regex(/^[0-9a-f]{64}$/i) })
        .safeParse(reply.body);
      if (reply.httpStatus === 200 && proof.success)
        return { kind: 'proof', proof: proof.data.proof.toLowerCase() };
      // A 200 we can't read moved nothing: let the customer try again.
      if (reply.httpStatus === 200)
        return {
          kind: 'retry',
          message: 'Could not check your PIN. Please try again.',
        };
      const code = codeOf(reply);
      if (code === 'PIN_INCORRECT') {
        const left = reply.body.attemptsRemaining;
        return {
          kind: 'retry',
          message:
            typeof left === 'number'
              ? `That PIN is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.`
              : 'That PIN is not right.',
        };
      }
      if (code === 'PIN_BUSY')
        return {
          kind: 'retry',
          message: 'Please wait a moment and try again.',
        };
      if (code === 'PIN_LOCKED') return outcome('pin_locked');
      if (code === 'PIN_NOT_SET' || code === 'PIN_RESET_REQUIRED')
        return outcome('pin_setup');
      return refusal(reply) ?? outcome('failed');
    },
    async pay(operationId, proof) {
      if (!lookupId) return outcome('pending');
      const reply = await imeiWalletPayApi.pay(connection, {
        lookupId,
        operationId,
        pinProof: proof,
        imei,
      });
      return imeiPayAnswer(reply, tier, proof === '');
    },
  };
}

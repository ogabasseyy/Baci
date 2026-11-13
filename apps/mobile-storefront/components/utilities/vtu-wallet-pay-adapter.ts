import { z } from 'zod';
import type {
  WalletPayAdapter,
  WalletPayOutcome,
  WalletPayPayAnswer,
} from '@/components/wallet-pay/wallet-pay.types';
import { WalletOnlyVtuResponseSchema } from '@/lib/vtu-checkout-response-schemas';
import type {
  WalletPayConnection,
  WalletPayReply,
} from '@/lib/wallet-pay/imei-wallet-pay-api';
import {
  type VtuWalletPayRequest,
  vtuWalletPayApi,
} from '@/lib/wallet-pay/vtu-wallet-pay-api';

export type VtuWalletPayResult = {
  amount?: number;
  reference: string;
  voucherPin?: string;
};

const issued = z.object({
  status: z.enum(['payment_required', 'payment_pending', 'payment_review']),
  transactionId: z.uuid(),
  operationId: z.uuid(),
  amountKobo: z.number().int().positive(),
});

const codeOf = (reply: WalletPayReply) =>
  typeof reply.body.code === 'string' ? reply.body.code : '';
const outcome = (kind: WalletPayOutcome['kind'], maybePaid = false) => ({
  kind: 'outcome' as const,
  outcome: maybePaid ? { kind, maybePaid } : { kind },
});

/** Answers before any money moves (maybePaid when a payment may be out). */
function refusal(reply: WalletPayReply, maybePaid = false) {
  const code = codeOf(reply);
  if (reply.httpStatus === 401 || code === 'UNAUTHORIZED')
    return outcome('sign_in', maybePaid);
  if (
    code.startsWith('PIGGYVEST_PAY_UNAVAILABLE') ||
    code === 'PIGGYVEST_WALLET_NOT_READY' ||
    code === 'PIN_UNAVAILABLE'
  )
    return outcome('unavailable', maybePaid);
  if (code === 'INSUFFICIENT_FUNDS') return outcome('insufficient');
  if (code === 'PAYMENT_NOT_COMPLETED') return outcome('not_completed');
  return null;
}

function delivered(
  reply: WalletPayReply,
  /** The issued payment's amount, when the answer carries none. */
  paidKobo: number | null = null
): { kind: 'delivered'; result: VtuWalletPayResult } | null {
  const parsed = WalletOnlyVtuResponseSchema.safeParse(reply.body);
  if (reply.httpStatus !== 200 || !parsed.success) return null;
  if (parsed.data.status !== 'successful') return null;
  const { reference, voucherPin } = parsed.data;
  const amount =
    parsed.data.amount ?? (paidKobo === null ? undefined : paidKobo / 100);
  return { kind: 'delivered', result: { amount, reference, voucherPin } };
}

/** Maps a pay (or re-check) answer. Money may have moved: unknown = pending. */
export function vtuPayAnswer(
  reply: WalletPayReply,
  paidKobo: number | null = null
): WalletPayPayAnswer<VtuWalletPayResult> {
  const result = delivered(reply, paidKobo);
  if (result) return result;
  if (reply.body.refund === 'piggyvest_wallet') return outcome('refunded');
  if (reply.httpStatus === 202) {
    if (reply.body.status === 'payment_refunding') return outcome('refunded');
    if (reply.body.status === 'payment_review') return outcome('review');
    return outcome('pending');
  }
  const code = codeOf(reply);
  if (code === 'PIN_PROOF_REQUIRED' || code === 'PIN_PROOF_REFUSED')
    return { kind: 'pin_again', message: 'Please enter your PIN again.' };
  return refusal(reply, true) ?? outcome('pending');
}

/**
 * The airtime, data or bill purchase's wallet pay steps. One
 * Idempotency-Key per purchase, so a retried start finds the same purchase
 * and payment instead of a new one.
 */
export function createVtuWalletPayAdapter(input: {
  connection: WalletPayConnection;
  request: VtuWalletPayRequest;
  idempotencyKey: string;
  expectedUserId?: string;
}): WalletPayAdapter<VtuWalletPayResult> {
  let transactionId: string | null = null;
  let paidKobo: number | null = null;
  const { connection } = input;
  const purchase = {
    request: input.request,
    idempotencyKey: input.idempotencyKey,
    expectedUserId: input.expectedUserId,
  };
  return {
    async start() {
      const reply = await vtuWalletPayApi.start(connection, purchase);
      const payment = issued.safeParse(reply.body);
      if (reply.httpStatus === 202 && payment.success) {
        transactionId = payment.data.transactionId;
        const { operationId, amountKobo } = payment.data;
        paidKobo = amountKobo;
        if (payment.data.status === 'payment_required')
          return { kind: 'pin', operationId, amountKobo };
        return { kind: 'recheck', operationId, amountKobo };
      }
      // An accepted answer we can't read is an unknown: keep confirming.
      if (reply.httpStatus === 202) return outcome('pending');
      const replayed = delivered(reply);
      if (replayed) return replayed;
      if (reply.body.refund === 'piggyvest_wallet') return outcome('refunded');
      // A server error may come after the purchase and its payment were
      // created: keep the key (a start never moves money) and try again.
      const refused = refusal(reply);
      if (refused) return refused;
      return reply.httpStatus >= 500
        ? outcome('not_started')
        : outcome('failed');
    },
    async verifyPin(operationId, pin) {
      // No payment was started (the sheet never shows the PIN then): ask to
      // try again rather than call it a failed payment.
      if (!transactionId) return outcome('not_started');
      const reply = await vtuWalletPayApi.verifyPin(connection, {
        transactionId,
        operationId,
        pin,
      });
      const proof = z
        .object({ proof: z.string().regex(/^[0-9a-f]{64}$/i) })
        .safeParse(reply.body);
      if (reply.httpStatus === 200 && proof.success)
        return { kind: 'proof', proof: proof.data.proof.toLowerCase() };
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
      const reply = await vtuWalletPayApi.pay(connection, {
        ...purchase,
        operationId,
        pinProof: proof,
      });
      return vtuPayAnswer(reply, paidKobo);
    },
  };
}

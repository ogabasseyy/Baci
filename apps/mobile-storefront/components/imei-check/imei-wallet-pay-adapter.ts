import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';
import { z } from 'zod';
import type {
  WalletPayAdapter,
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
// Only the app's own wording reaches the outcome card, never server text.
const IMEI_MISMATCH_TEXT =
  'This IMEI does not match the check you started. Nothing more was taken.';
const outcome = (kind: WalletPayOutcome['kind'], message?: string) => ({
  kind: 'outcome' as const,
  outcome: message ? { kind, message } : { kind },
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
): WalletPayPayAnswer<ImeiWalletPayResult> | null {
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
  tier: ImeiServiceTierKey
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
  if (code === 'IMEI_MISMATCH') return outcome('failed', IMEI_MISMATCH_TEXT);
  return refusal(reply) ?? outcome('pending');
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
        if (payment.data.status === 'payment_required')
          return { kind: 'pin', operationId, amountKobo };
        if (payment.data.status === 'payment_review') return outcome('review');
        return { kind: 'recheck', operationId, amountKobo };
      }
      return refusal(reply) ?? outcome('failed');
    },
    async verifyPin(operationId, pin) {
      if (!lookupId) return outcome('failed');
      const reply = await imeiWalletPayApi.verifyPin(connection, {
        lookupId,
        operationId,
        pin,
      });
      const proof = z
        .object({ proof: z.string().regex(/^[0-9a-f]{64}$/) })
        .safeParse(reply.body);
      if (reply.httpStatus === 200 && proof.success)
        return { kind: 'proof', proof: proof.data.proof };
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
      return imeiPayAnswer(reply, tier);
    },
  };
}

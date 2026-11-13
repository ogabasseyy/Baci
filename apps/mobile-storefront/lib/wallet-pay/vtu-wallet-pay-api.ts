import { CONFIG } from '@/lib/config';
import { normalizeVtuCheckoutPayload } from '@/lib/vtu-checkout-helpers';
import type { VTUCheckoutPayload } from '@/lib/vtu-checkout-response-schemas';
import { postWalletPay, type WalletPayConnection } from './imei-wallet-pay-api';

const CHECKOUT_PATH = '/api/vtu/checkout/wallet-only';

export type VtuWalletPayRequest = VTUCheckoutPayload & { walletAmount: number };

/**
 * The calls of an airtime, data or bill purchase paid from the PiggyVest
 * wallet. Start and pay are the wallet-only checkout with the same purchase
 * and the same Idempotency-Key (the server pays only rows it prepared as
 * PiggyVest-paid, at their stored amount). The PIN is only placed in the
 * PIN check's body; it is never stored or logged.
 */
export const vtuWalletPayApi = {
  /** Prepares the purchase and asks the server to issue the payment. */
  start: (
    connection: WalletPayConnection,
    input: {
      request: VtuWalletPayRequest;
      idempotencyKey: string;
      expectedUserId?: string;
    }
  ) =>
    postWalletPay(
      connection,
      CHECKOUT_PATH,
      {
        ...normalizeVtuCheckoutPayload(input.request),
        merchantSlug: CONFIG.MERCHANT_SLUG,
        paymentMethod: 'piggyvest_wallet',
        ...(input.expectedUserId
          ? { expectedUserId: input.expectedUserId }
          : {}),
      },
      input.idempotencyKey
    ),
  /** Checks the PIN for this payment and returns a single-use proof. */
  verifyPin: (
    connection: WalletPayConnection,
    input: { transactionId: string; operationId: string; pin: string }
  ) => postWalletPay(connection, '/api/vtu/checkout/wallet-pin', input),
  /**
   * Spends the proof and sends the payment once, then the purchase is
   * vended. An empty proof only checks on a payment already sent.
   */
  pay: (
    connection: WalletPayConnection,
    input: {
      request: VtuWalletPayRequest;
      idempotencyKey: string;
      expectedUserId?: string;
      operationId: string;
      pinProof: string;
    }
  ) =>
    postWalletPay(
      connection,
      CHECKOUT_PATH,
      {
        ...normalizeVtuCheckoutPayload(input.request),
        merchantSlug: CONFIG.MERCHANT_SLUG,
        paymentMethod: 'piggyvest_wallet',
        ...(input.expectedUserId
          ? { expectedUserId: input.expectedUserId }
          : {}),
        walletPayOperationId: input.operationId,
        walletPayPinProof: input.pinProof,
      },
      input.idempotencyKey
    ),
  /**
   * The sheet closed before any PIN: releases the issued payment (never a
   * reserved one) and closes the purchase. Best effort; nothing is paid.
   */
  cancel: (
    connection: WalletPayConnection,
    input: {
      request: VtuWalletPayRequest;
      idempotencyKey: string;
      expectedUserId?: string;
      operationId: string;
    }
  ) =>
    postWalletPay(
      connection,
      CHECKOUT_PATH,
      {
        ...normalizeVtuCheckoutPayload(input.request),
        merchantSlug: CONFIG.MERCHANT_SLUG,
        paymentMethod: 'piggyvest_wallet',
        ...(input.expectedUserId
          ? { expectedUserId: input.expectedUserId }
          : {}),
        walletPayOperationId: input.operationId,
        walletPayCancel: true,
      },
      input.idempotencyKey
    ),
};

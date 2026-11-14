import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';

/** One server answer: the HTTP status and its JSON body ({} when unreadable). */
export type WalletPayReply = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export type WalletPayConnection = {
  apiBaseUrl: string;
  /** A token, or a getter read on every request (sessions refresh). */
  accessToken: string | undefined | (() => string | undefined);
  fetchImpl?: typeof fetch;
};

/** Same limit as the store credit IMEI request. */
export const WALLET_PAY_TIMEOUT_MS = 30_000;

/** One wallet pay POST: Bearer token, optional Idempotency-Key, 30 s limit. */
export async function postWalletPay(
  connection: WalletPayConnection,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string
): Promise<WalletPayReply> {
  // The whole request, body included, gives up after the timeout: a hung
  // request (or a body that never finishes) rejects instead of holding the
  // sheet on "Paying...", and the caller treats it as unknown and re-checks.
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Wallet pay request timed out'));
    }, WALLET_PAY_TIMEOUT_MS);
  });
  const token =
    typeof connection.accessToken === 'function'
      ? connection.accessToken()
      : connection.accessToken;
  const send = async (): Promise<WalletPayReply> => {
    const response = await (connection.fetchImpl ?? fetch)(
      `${connection.apiBaseUrl}${path}`,
      {
        signal: controller.signal,
        body: JSON.stringify(body),
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        method: 'POST',
      }
    );
    const parsed: unknown = await response.json().catch(() => null);
    return {
      httpStatus: response.status,
      body:
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {},
    };
  };
  const sending = send();
  // After a timeout the aborted request still rejects: observe it.
  sending.catch(() => undefined);
  try {
    return await Promise.race([sending, timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

const lookupPath = (lookupId: string, step: 'wallet-pin' | 'wallet-pay') =>
  `/api/storefront/imei-check/${encodeURIComponent(lookupId)}/${step}`;

/**
 * The three calls of an IMEI check paid from the PiggyVest wallet. The client
 * never sends an amount: the server reads it from the payment it issued. The
 * PIN is only placed in the verify body; it is never stored or logged.
 */
export const imeiWalletPayApi = {
  /** Creates the lookup and asks the server to issue a wallet payment. */
  start: (
    connection: WalletPayConnection,
    input: {
      device: ImeiDeviceCategory;
      tier: ImeiServiceTierKey;
      imei: string;
      idempotencyKey: string;
    }
  ) =>
    postWalletPay(
      connection,
      '/api/storefront/imei-check',
      {
        clientCapabilities: ['imei-async-v1'],
        device: input.device,
        imei: input.imei,
        paymentMethod: 'piggyvest_wallet',
        tier: input.tier,
      },
      input.idempotencyKey
    ),
  /** Checks the PIN for this payment and returns a single-use proof. */
  verifyPin: (
    connection: WalletPayConnection,
    input: { lookupId: string; operationId: string; pin: string }
  ) =>
    postWalletPay(connection, lookupPath(input.lookupId, 'wallet-pin'), {
      operationId: input.operationId,
      pin: input.pin,
    }),
  /**
   * Spends the proof and sends the payment once. An empty proof only checks
   * on a payment already sent: it never moves money again.
   */
  pay: (
    connection: WalletPayConnection,
    input: {
      lookupId: string;
      operationId: string;
      pinProof: string;
      imei: string;
    }
  ) =>
    postWalletPay(connection, lookupPath(input.lookupId, 'wallet-pay'), {
      imei: input.imei,
      operationId: input.operationId,
      pinProof: input.pinProof,
    }),
};

import type { ImeiDeviceCategory, ImeiServiceTierKey } from '@baci/shared/imei';

/** One server answer: the HTTP status and its JSON body ({} when unreadable). */
export type WalletPayReply = {
  httpStatus: number;
  body: Record<string, unknown>;
};

export type WalletPayConnection = {
  apiBaseUrl: string;
  accessToken: string | undefined;
  fetchImpl?: typeof fetch;
};

/** Same limit as the store credit IMEI request. */
export const WALLET_PAY_TIMEOUT_MS = 30_000;

async function post(
  connection: WalletPayConnection,
  path: string,
  body: Record<string, unknown>,
  idempotencyKey?: string
): Promise<WalletPayReply> {
  // A hung request rejects instead of holding the sheet on "Paying...":
  // the caller treats it as unknown (pending) and re-checks.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WALLET_PAY_TIMEOUT_MS);
  const response = await (connection.fetchImpl ?? fetch)(
    `${connection.apiBaseUrl}${path}`,
    {
      signal: controller.signal,
      body: JSON.stringify(body),
      headers: {
        ...(connection.accessToken
          ? { Authorization: `Bearer ${connection.accessToken}` }
          : {}),
        'Content-Type': 'application/json',
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      method: 'POST',
    }
  ).finally(() => clearTimeout(timer));
  const parsed: unknown = await response.json().catch(() => null);
  return {
    httpStatus: response.status,
    body:
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {},
  };
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
    post(
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
    post(connection, lookupPath(input.lookupId, 'wallet-pin'), {
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
    post(connection, lookupPath(input.lookupId, 'wallet-pay'), {
      imei: input.imei,
      operationId: input.operationId,
      pinProof: input.pinProof,
    }),
};

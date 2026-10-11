import type { NextRequest } from 'next/server';
import {
  type VtuWalletOnlyChargeInput,
  vtuWalletOnlyChargeSchema,
} from '@/schemas/vtu-wallet-only';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ParsedWalletOnlyCheckoutRequest =
  | {
      ok: true;
      idempotencyKey: string;
      input: VtuWalletOnlyChargeInput;
    }
  | {
      ok: false;
      error: string;
      status: number;
      details?: unknown;
    };

/**
 * Parses + validates a wallet-only VTU checkout request: the
 * `Idempotency-Key` header (UUID), the JSON body against
 * `vtuWalletOnlyChargeSchema`, and the full-coverage rule
 * (`walletAmount === amount` — partial coverage is unsupported
 * everywhere since the gateway routes are disabled). Extracted from
 * the wallet-only route to keep that file under the 300-line
 * modularity budget.
 */
export async function parseWalletOnlyCheckoutRequest(
  request: NextRequest
): Promise<ParsedWalletOnlyCheckoutRequest> {
  // UUIDs are case-insensitive per RFC 4122 but the DB column is
  // case-sensitive. Normalize to lowercase before storing/comparing so
  // a retry with `K` capitalized differently doesn't create a new key
  // → new vtu_transaction → orphan row.
  const rawIdempotencyKey = request.headers.get('Idempotency-Key') ?? '';
  if (!rawIdempotencyKey || !UUID_PATTERN.test(rawIdempotencyKey)) {
    return {
      ok: false,
      error:
        'Missing or invalid Idempotency-Key header (UUID required for wallet payments).',
      status: 400,
    };
  }
  const idempotencyKey = rawIdempotencyKey.toLowerCase();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Malformed JSON body. Don't let it bubble to the generic 500
    // catch — that would obscure the actual cause from the client.
    return { ok: false, error: 'Invalid JSON body.', status: 400 };
  }
  const parsed = vtuWalletOnlyChargeSchema.safeParse({
    ...(typeof body === 'object' && body !== null ? body : {}),
    source: 'checkout',
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid input',
      status: 400,
      details: parsed.error.flatten(),
    };
  }
  if (parsed.data.walletAmount !== parsed.data.amount) {
    return {
      ok: false,
      error:
        'wallet-only checkout requires walletAmount === amount; partial wallet coverage is not supported.',
      status: 400,
    };
  }

  return { ok: true, idempotencyKey, input: parsed.data };
}

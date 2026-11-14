import type { z } from 'zod';
import { PiggyvestPrimaryWalletSchemas as schemas } from '@/schemas/piggyvest-primary-wallet';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

type PrimaryAccount = Extract<
  z.infer<typeof schemas.snapshot>,
  { status: 'ready' }
>['account'];

const PATH = '/api/storefront/customer/wallet/piggyvest-primary';

// Fresh client per operation: the factory caches the access token in a
// closure, so a module-level singleton would keep serving the previous
// user's Bearer [REDACTED] after an account switch. The expected user binds
// inside the client's own session read, so a switch between the caller's
// check and this send still authenticates as the expected user or throws
// before any bytes leave the device.
export interface PiggyvestPrimarySnapshot {
  account: PrimaryAccount | null;
  /** Kobo; null until the account is ready. */
  balanceKobo?: number | null;
  requiresConsent: boolean;
  provisioningStatus: 'pending' | 'ready';
}

async function read(
  merchantId: string,
  userId?: string
): Promise<PiggyvestPrimarySnapshot> {
  const client = createStorefrontCustomerApiClient();
  const data = await client.fetchJson({
    path: `${PATH}?merchantId=${encodeURIComponent(merchantId)}`,
    expectedUserId: userId,
  });
  // The schema is the only gate: anything it rejects (including a negative or
  // fractional balance) is treated like the server being off, so no primary
  // balance or account is ever surfaced from an unrecognised answer.
  const snapshot = schemas.snapshot.safeParse(data);
  if (!snapshot.success)
    throw new Error(
      'Could not confirm your wallet account. Please refresh later.'
    );
  const parsed = snapshot.data;
  return {
    account: parsed.account,
    // Kobo, straight from the schema; absent until the account is ready.
    ...(parsed.status === 'ready' ? { balanceKobo: parsed.balanceKobo } : {}),
    requiresConsent: parsed.status !== 'ready',
    provisioningStatus: parsed.status,
  };
}

async function create(
  input: {
    merchantId: string;
    bvn: string;
    consent: boolean;
  },
  userId?: string
) {
  const parsed = schemas.create.safeParse(input);
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ?? 'Check your wallet setup details.'
    );
  }
  const client = createStorefrontCustomerApiClient();
  const data = await client.fetchJson({
    path: PATH,
    method: 'POST',
    body: parsed.data,
    includeCsrf: true,
    expectedUserId: userId,
  });
  if (!schemas.created.safeParse(data).success)
    throw new Error(
      'Wallet setup could not be confirmed. Please refresh later.'
    );
  return read(parsed.data.merchantId, userId);
}

export const piggyvestPrimaryWalletApi = { read, create };

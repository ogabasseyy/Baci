import { PiggyvestPrimaryWalletSchemas as schemas } from '@/schemas/piggyvest-primary-wallet';
import { createStorefrontCustomerApiClient } from './storefront-customer-api-client';

const PATH = '/api/storefront/customer/wallet/piggyvest-primary';

// Fresh client per operation: the factory caches the access token in a
// closure, so a module-level singleton would keep serving the previous
// user's Bearer [REDACTED] after an account switch.
async function read(merchantId: string) {
  const client = createStorefrontCustomerApiClient();
  const data = await client.fetchJson({
    path: `${PATH}?merchantId=${encodeURIComponent(merchantId)}`,
  });
  const snapshot = schemas.snapshot.safeParse(data);
  if (!snapshot.success)
    throw new Error(
      'Could not confirm your PiggyVest account. Please refresh later.'
    );
  return {
    account: snapshot.data.account,
    requiresConsent: snapshot.data.status !== 'ready',
    provisioningStatus: snapshot.data.status,
  };
}

async function create(input: {
  merchantId: string;
  bvn: string;
  consent: boolean;
}) {
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
  });
  if (!schemas.created.safeParse(data).success)
    throw new Error(
      'Wallet setup could not be confirmed. Please refresh later.'
    );
  return read(parsed.data.merchantId);
}

export const piggyvestPrimaryWalletApi = { read, create };

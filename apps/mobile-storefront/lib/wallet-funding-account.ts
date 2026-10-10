import { createStorefrontCustomerApiClient } from '@/lib/storefront-customer-api-client';
import { WalletFundingAccountResponseSchema } from '@/schemas/wallet-funding-account';
import { useAuthStore } from '@/stores/auth-store';
import { isPiggyvestPrimaryMerchant } from './is-piggyvest-primary-merchant';
import {
  getPiggyvestPrimaryCapability,
  rollbackObservedCapabilityOnNotReady,
} from './piggyvest-primary-capability';
import { readObservedPiggyvestPrimaryCapability } from './piggyvest-primary-capability-cache';
import { piggyvestPrimaryWalletApi } from './piggyvest-primary-wallet';

export type { WalletFundingAccount } from '@/schemas/wallet-funding-account';

const walletFundingApiClient = createStorefrontCustomerApiClient();

function parseWalletFundingAccountResponse({
  data,
  operation,
}: {
  data: unknown;
  operation: 'create' | 'get';
}) {
  const parsed = WalletFundingAccountResponseSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(
      `Invalid wallet funding account ${operation} response: ${parsed.error.message}`
    );
  }

  return parsed.data;
}

/**
 * Loads the signed-in customer's wallet funding account for a merchant.
 *
 * Merchant context is sent through the shared customer API client. When both
 * identifiers are available, the client sends both so the server can validate
 * the UUID against the storefront slug. When `merchantSlug` is blank, the
 * client falls back to `CONFIG.MERCHANT_SLUG`; callers should still pass the
 * active merchant UUID when they have it so account lookup stays tenant scoped.
 *
 * @param merchantId Optional merchant UUID used to scope the request.
 * @param merchantSlug Optional storefront slug; defaults through the shared customer API client.
 * @returns Parsed funding-account state from GET /api/storefront/customer/wallet/funding-account.
 */
export async function getWalletFundingAccount({
  merchantId,
  merchantSlug,
  userId,
}: {
  merchantId?: string | null;
  merchantSlug?: string | null;
  userId?: string | null;
}) {
  // Bind the primary read to the caller when known, else to whoever is
  // signed in at call time: the client authenticates with the token it
  // read for that user (or throws), so a mid-flight switch cannot
  // return another user's funding account.
  const expectedUserId = userId ?? useAuthStore.getState().user?.id;
  if (isPiggyvestPrimaryMerchant(merchantId)) {
    try {
      return await piggyvestPrimaryWalletApi.read(
        merchantId ?? '',
        expectedUserId ?? undefined
      );
    } catch (error) {
      if (!rollbackObservedCapabilityOnNotReady(merchantId, error)) throw error;
    }
  }
  const data = await walletFundingApiClient.fetchJson({
    path: '/api/storefront/customer/wallet/funding-account',
    query: { merchantId, merchantSlug },
  });
  return parseWalletFundingAccountResponse({ data, operation: 'get' });
}

/**
 * Creates or returns the signed-in customer's wallet funding account after consent.
 *
 * @param merchantId Optional merchant UUID used to scope the request.
 * @param merchantSlug Optional storefront slug; defaults through the shared customer API client.
 * @returns Parsed funding-account state from POST /api/storefront/customer/wallet/funding-account.
 */
export async function createWalletFundingAccount({
  merchantId,
  merchantSlug,
  bvn,
  consent,
  userId,
}: {
  merchantId?: string | null;
  merchantSlug?: string | null;
  bvn?: string;
  consent?: boolean;
  userId?: string | null;
}) {
  // Same bind as the read above: the client rejects a mismatched
  // session before the BVN leaves the device, so a mid-flight switch
  // cannot onboard the new account with the previous account's BVN.
  const expectedUserId = userId ?? useAuthStore.getState().user?.id;
  // Probe-first routing: an unobserved (never-probed) merchant must not
  // fall straight through to the legacy DVA creation below. The checkout
  // bank-transfer path calls this directly after consent — bypassing the
  // wallet screen's pending-verdict guard — so a cold-start server-enabled
  // merchant would mint a legacy DVA that a primary verdict orphans.
  // Only an authoritative cached negative skips the probe; an ambiguous
  // probe failure throws instead of minting legacy on a guess.
  const unobserved =
    !!merchantId && readObservedPiggyvestPrimaryCapability(merchantId) === null;
  if (isPiggyvestPrimaryMerchant(merchantId) || unobserved) {
    // Defer the BVN demand until primary is confirmed: when the server is
    // unconfigured, callers without BVN must still reach the legacy DVA
    // creation below instead of failing the preflight.
    if (await getPiggyvestPrimaryCapability(merchantId ?? '')) {
      if (!bvn || consent !== true)
        throw new Error(
          'Your BVN and consent are required for PiggyVest wallet setup. No bank account was created.'
        );
      try {
        return await piggyvestPrimaryWalletApi.create(
          {
            merchantId: merchantId ?? '',
            bvn,
            consent,
          },
          expectedUserId ?? undefined
        );
      } catch (error) {
        if (!rollbackObservedCapabilityOnNotReady(merchantId, error))
          throw error;
      }
    }
  }
  const data = await walletFundingApiClient.fetchJson({
    body: {
      consent: true,
      ...walletFundingApiClient.buildMerchantIdentifiers({
        merchantId,
        merchantSlug,
      }),
    },
    method: 'POST',
    path: '/api/storefront/customer/wallet/funding-account',
  });
  return parseWalletFundingAccountResponse({ data, operation: 'create' });
}

import 'server-only';
import { PIGGYVEST_API_BASE_URL } from './client';
import { requestPrefundedCardProviderJson } from './prefunded-card-provider-request';
import { readPrimaryWalletPaidInterestRuntime } from './primary-wallet-paid-interest-runtime';
import { applyPrimaryWalletSignedPaidInterest } from './primary-wallet-paid-interest-signed';
import { createPrimaryWalletPaidInterestStore } from './primary-wallet-paid-interest-store';

export async function dispatchPrimaryWalletPaidInterest(input: {
  rawBody: Uint8Array;
  signature: string | null;
  env?: NodeJS.ProcessEnv;
  fetchImplementation?: typeof fetch;
  // The inbox worker drains through 'drain' so a flag rollback cannot
  // strand acknowledged receipts; direct webhook intake stays 'intake'.
  mode?: 'intake' | 'drain';
}) {
  const configuration = readPrimaryWalletPaidInterestRuntime(
    input.env,
    input.mode ?? 'intake'
  );
  if (!configuration) return 'disabled' as const;
  const store = createPrimaryWalletPaidInterestStore(configuration);
  return await applyPrimaryWalletSignedPaidInterest({
    ...input,
    configuration,
    ...store,
    retrieveWallet: async (walletId) =>
      await requestPrefundedCardProviderJson({
        url: `${PIGGYVEST_API_BASE_URL}/api/v1/wallet/${encodeURIComponent(walletId)}`,
        token: configuration.providerToken,
        timeoutMs: 10000,
        maxResponseBytes: 65536,
        fetchImplementation: input.fetchImplementation ?? fetch,
        init: { method: 'GET' },
      }),
  });
}

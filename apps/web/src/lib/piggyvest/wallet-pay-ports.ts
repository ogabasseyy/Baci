import 'server-only';
import type {
  WalletPayPaymentReservation,
  WalletPayRefundReservation,
} from '@/schemas/piggyvest-wallet-pay';
import { createPrimaryWalletEvidenceExecutor } from './primary-wallet-evidence-executor';
import { getPrimaryWalletProviderOrigin } from './primary-wallet-provider-origin';
import { createPrimaryWalletSavingsExecutor } from './primary-wallet-savings-executor';
import { createSavingsVerifyQueryProvider } from './primary-wallet-savings-reconciliation-runtime';
import { lookupSavingsTransferReference } from './primary-wallet-savings-transfer-lookup';
import { transferToWallet } from './transfers';
import { createWalletPayEvidenceStore } from './wallet-pay-evidence-store';
import type { WalletPayRuntime } from './wallet-pay-runtime';
import {
  createWalletPayCustomerStore,
  createWalletPayWorkerStore,
} from './wallet-pay-store';
import { retrievePiggyvestWallet } from './wallets';

type Transfer = WalletPayPaymentReservation | WalletPayRefundReservation;

/** Live PiggyVest + database wiring for one runtime. Tests replace this module. */
export function createWalletPayPorts(runtime: WalletPayRuntime) {
  const { configuration, reconciliationConfiguration } = runtime;
  const provider = {
    token: runtime.providerToken,
    baseUrl: getPrimaryWalletProviderOrigin(configuration.environment),
  };
  const authorizer = createPrimaryWalletSavingsExecutor(configuration);
  return {
    customerStore: (scope: unknown) =>
      createWalletPayCustomerStore({ scope, execute: authorizer }),
    worker: createWalletPayWorkerStore({
      integrationId: configuration.integrationId,
      environment: configuration.environment,
      execute: authorizer,
    }),
    evidence: createWalletPayEvidenceStore({
      integrationId: reconciliationConfiguration.integrationId,
      environment: reconciliationConfiguration.environment,
      execute: createPrimaryWalletEvidenceExecutor(reconciliationConfiguration),
    }),
    queryProvider: createSavingsVerifyQueryProvider({
      environment: configuration.environment,
      token: provider.token,
    }),
    retrieveWallet: async (walletId: string) =>
      await retrievePiggyvestWallet(provider, walletId),
    lookupTransfer: async (transfer: Transfer) =>
      await lookupSavingsTransferReference({
        reference: transfer.reference,
        walletId: transfer.sourceWalletId,
        amountKobo: transfer.amountKobo,
        destinationWalletId: transfer.destinationWalletId,
        token: provider.token,
        baseUrl: provider.baseUrl,
      }),
    transfer: async (transfer: Transfer, narration: string) =>
      await transferToWallet(provider, {
        amountKobo: transfer.amountKobo,
        sourceWalletId: transfer.sourceWalletId,
        destinationWalletId: transfer.destinationWalletId,
        reference: transfer.reference,
        narration,
      }),
  };
}

export type WalletPayPorts = ReturnType<typeof createWalletPayPorts>;

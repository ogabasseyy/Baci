import 'server-only';
import { piggyvestPrimaryWalletSnapshotSchemas as schemas } from '@/schemas/piggyvest-primary-wallet-snapshot';
import type { PrimaryWalletVerificationProof } from './primary-wallet-verification';

type Input = {
  businessId: string;
  loadMapping: () => Promise<unknown>;
  retrieveWallet: (walletId: string) => Promise<unknown>;
  retrieveAccounts: (walletId: string) => Promise<unknown>;
  verifyMapping: (proof: PrimaryWalletVerificationProof) => Promise<boolean>;
};

type Snapshot =
  | { status: 'pending' | 'unavailable'; account: null }
  | {
      status: 'ready';
      balanceKobo: number;
      account: {
        accountNumber: string;
        accountName: string;
        bankName: string;
        provider: 'piggyvest';
      };
    };

export async function readPrimaryWalletSnapshot(
  input: Input
): Promise<Snapshot> {
  try {
    const mapping = schemas.mapping.parse(await input.loadMapping());
    if (!mapping) return { status: 'pending', account: null };
    const wallet = schemas.wallet.parse(
      await input.retrieveWallet(mapping.providerWalletId)
    );
    if (
      wallet.id !== mapping.providerWalletId ||
      wallet.api_customer_id !== mapping.providerCustomerId ||
      wallet.business_id !== input.businessId
    ) {
      return { status: 'unavailable', account: null };
    }
    if (wallet.status !== 'active') return { status: 'pending', account: null };
    const accounts = schemas.accounts.parse(
      await input.retrieveAccounts(mapping.providerWalletId)
    );
    const account = accounts[0];
    if (!account) return { status: 'pending', account: null };
    if ((await input.verifyMapping({ mapping, wallet, accounts })) !== true) {
      return { status: 'unavailable', account: null };
    }
    return {
      status: 'ready',
      balanceKobo: wallet.balance,
      account: {
        accountNumber: account.account_number,
        accountName: account.account_name,
        bankName: account.bank_name,
        provider: 'piggyvest',
      },
    };
  } catch {
    return { status: 'unavailable', account: null };
  }
}

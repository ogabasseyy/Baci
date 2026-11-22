import 'server-only';
import { z } from 'zod';
import { readWalletDvaProvisionerRuntime } from '@/schemas/wallet-dva-provisioner-runtime';
import {
  type CustomerWalletPaymentAccount,
  CustomerWalletPaymentAccountError,
  type CustomerWalletPaymentAccountRow,
  normalizeWalletPaymentAccount,
} from './customer-wallet-payment-account-types';
import {
  createWalletDvaProvisionerExecutor,
  type WalletDvaProvisionerInput,
} from './wallet-dva-provisioner-executor';

const accountRowSchema = z.strictObject({
  account_name: z.string(),
  account_number: z.string(),
  bank_name: z.string(),
  bank_slug: z.string().nullable(),
  consented_at: z.string(),
  currency: z.string(),
  customer_id: z.string().uuid(),
  id: z.string().uuid(),
  merchant_id: z.string().uuid(),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  provider: z.string(),
  provider_account_id: z.string().nullable(),
  provider_customer_code: z.string(),
  provider_subaccount_code: z.string(),
  status: z.string(),
});

export type WalletDvaAccountWriter = (
  input: WalletDvaProvisionerInput
) => Promise<CustomerWalletPaymentAccount>;

export function createWalletDvaAccountWriter() {
  const configuration = readWalletDvaProvisionerRuntime();
  if (!configuration) return null;

  const execute = createWalletDvaProvisionerExecutor(configuration);
  return async (input: WalletDvaProvisionerInput) => {
    let result: unknown;
    try {
      result = await execute(input);
    } catch (error) {
      const code =
        error instanceof Error
          ? error.message
          : 'Wallet DVA writer unavailable';
      const safeError = {
        WALLET_DVA_DISABLED_ACCOUNT: [
          'WALLET_DVA_DISABLED_ACCOUNT',
          'This wallet transfer account was disabled after review. Contact support to re-enable it.',
        ],
        WALLET_DVA_PENDING_REVIEW_CONFLICT: [
          'WALLET_DVA_PENDING_REVIEW_CONFLICT',
          'Existing wallet DVA is under review for a different Paystack account',
        ],
        WALLET_DVA_PROVIDER_CUSTOMER_CONFLICT: [
          'WALLET_DVA_PROVIDER_CUSTOMER_CONFLICT',
          'The provider customer does not match the wallet owner',
        ],
        WALLET_DVA_RECEIVER_CONFLICT: [
          'WALLET_DVA_RECEIVER_CONFLICT',
          'This Paystack wallet DVA is already assigned to another customer',
        ],
        WALLET_DVA_SUBACCOUNT_CONFLICT: [
          'WALLET_DVA_SUBACCOUNT_CONFLICT',
          'Existing wallet DVA belongs to a different Paystack subaccount',
        ],
        PAYSTACK_DVA_ALIAS_CONFLICT: [
          'WALLET_DVA_ORDER_ALIAS_CONFLICT',
          'This Paystack account is still reserved for an active order payment',
        ],
      } as const;
      const mapped = safeError[code as keyof typeof safeError];
      if (mapped) {
        throw new CustomerWalletPaymentAccountError(mapped[0], mapped[1]);
      }
      throw new CustomerWalletPaymentAccountError(
        'WALLET_DVA_WRITER_UNAVAILABLE',
        'Wallet funding account storage is unavailable'
      );
    }

    const parsed = accountRowSchema.safeParse(result);
    if (
      !parsed.success ||
      parsed.data.customer_id !== input.customerId ||
      parsed.data.merchant_id !== input.merchantId
    ) {
      // Never return or log an executor row outside the authenticated owner
      // slot, even if a misconfigured test double or database response does.
      throw new CustomerWalletPaymentAccountError(
        'WALLET_DVA_STORAGE_ERROR',
        'Wallet funding account storage returned an invalid owner binding'
      );
    }

    try {
      return normalizeWalletPaymentAccount(
        parsed.data as CustomerWalletPaymentAccountRow
      );
    } catch {
      throw new CustomerWalletPaymentAccountError(
        'WALLET_DVA_STORAGE_ERROR',
        'Wallet funding account storage returned an invalid account'
      );
    }
  };
}

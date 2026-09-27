import {
  type BankTransferParams,
  BankTransferParamsSchema,
  type WalletFundedBankTransferParams,
  WalletFundedBankTransferParamsSchema,
} from '@/schemas/bank-transfer-params';

export type ValidatedBankTransferParams =
  | {
      data: BankTransferParams;
      error: null;
      isValid: true;
      mode: 'legacy';
    }
  | {
      data: WalletFundedBankTransferParams;
      error: null;
      isValid: true;
      mode: 'wallet_funded';
    }
  | {
      data: null;
      error: string;
      isValid: false;
      mode: 'legacy' | 'wallet_funded';
    };

export function validateBankTransferParams(
  params: Record<string, string>
): ValidatedBankTransferParams {
  // `intentId` is a legacy deep-link fallback; an explicit walletFunded flag wins.
  const isWalletFunded =
    params.walletFunded === 'true' ||
    (params.walletFunded === undefined && Boolean(params.intentId));
  if (isWalletFunded) {
    const result = WalletFundedBankTransferParamsSchema.safeParse(params);
    return result.success
      ? {
          data: result.data,
          error: null,
          isValid: true,
          mode: 'wallet_funded' as const,
        }
      : {
          data: null,
          error: result.error.issues[0]?.message || 'Invalid parameters',
          isValid: false,
          mode: 'wallet_funded' as const,
        };
  }
  const result = BankTransferParamsSchema.safeParse(params);
  if (!result.success) {
    return {
      data: null,
      error: result.error.issues[0]?.message || 'Invalid parameters',
      isValid: false,
      mode: 'legacy' as const,
    };
  }
  return {
    data: result.data,
    error: null,
    isValid: true,
    mode: 'legacy',
  };
}

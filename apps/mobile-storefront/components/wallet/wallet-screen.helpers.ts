import { formatNgnCurrency } from '@/lib/format-ngn-currency';
import {
  WALLET_TOP_UP_MAX_AMOUNT,
  WALLET_TOP_UP_MIN_AMOUNT,
} from '@/lib/wallet-top-up-constants';
import {
  deriveWalletDisplayData,
  normalizeRequiredFundingAccountValue,
} from './derive-wallet-display-data';
import {
  CUSTOMER_PHONE_REQUIRED_ERROR_CODE,
  ORDER_ALIAS_CONFLICT_MESSAGE_FRAGMENT,
  WALLET_FUNDING_ACCOUNT_MESSAGES,
} from './wallet-funding-account.constants';

// Re-exported so existing importers (WalletScreen, tests) keep their path.
export { deriveWalletDisplayData };

interface CustomerLike {
  email?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

interface UserLike {
  email?: string | null;
}

interface WalletTopUpResultLike {
  authorization_url: string;
  gateway: string;
  reference: string;
}

interface WalletFundingAccountLike {
  accountNumber?: string | null;
  bankName?: string | null;
}

interface WalletCreateFundingAccountResultLike {
  account?: WalletFundingAccountLike | null;
}

interface WalletRedeemResultLike {
  conversionRate?: number | null;
  remainingPoints?: number | null;
  walletCredit?: number | null;
}

export type WalletCreateFundingAccountOutcome =
  | { accountSummary: string; status: 'success' }
  | { accountSummary?: undefined; status: 'success' }
  | { status: 'phone-required' }
  | {
      alertMessage: string;
      status: 'error';
      telemetryMessage: string;
    };

export type WalletRedeemPointsOutcome =
  | {
      message: string;
      status: 'invalid';
      title: string;
    }
  | {
      points: number;
      result: WalletRedeemResultLike;
      status: 'success';
      successMessage: string;
    }
  | {
      alertMessage: string;
      points: number;
      status: 'error';
      telemetryMessage: string;
    };

export async function resolveCreateFundingAccountOutcome(
  createFundingAccount: () => Promise<WalletCreateFundingAccountResultLike>
): Promise<WalletCreateFundingAccountOutcome> {
  try {
    const result = await createFundingAccount();
    const bankName = normalizeRequiredFundingAccountValue(
      result.account?.bankName
    );
    const accountNumber = normalizeRequiredFundingAccountValue(
      result.account?.accountNumber
    );
    if (bankName && accountNumber) {
      return {
        accountSummary: `${bankName} - ${accountNumber}`,
        status: 'success',
      };
    }

    return { status: 'success' };
  } catch (error) {
    // Stale local state can still show a phone while the server row has none;
    // surface it so callers can re-collect the number instead of alerting.
    if (
      error instanceof Error &&
      (error as Error & { code?: string }).code ===
        CUSTOMER_PHONE_REQUIRED_ERROR_CODE
    ) {
      return { status: 'phone-required' };
    }
    const rawMessage = error instanceof Error ? error.message : null;
    const isOrderAliasConflict = Boolean(
      rawMessage?.includes(ORDER_ALIAS_CONFLICT_MESSAGE_FRAGMENT)
    );
    return {
      alertMessage: isOrderAliasConflict
        ? WALLET_FUNDING_ACCOUNT_MESSAGES.ORDER_PAYMENT_IN_PROGRESS
        : (rawMessage ?? 'Please try again in a moment.'),
      status: 'error',
      telemetryMessage: rawMessage ?? 'Unknown error',
    };
  }
}

export async function resolveWalletRedeemPointsOutcome({
  minimumRedeemablePoints,
  rawPoints,
  redeemPoints,
}: {
  minimumRedeemablePoints: number;
  rawPoints: string;
  redeemPoints: (points: number) => Promise<WalletRedeemResultLike>;
}): Promise<WalletRedeemPointsOutcome> {
  const parsedRedeemInput = parseWalletRedeemPointsInput(
    rawPoints,
    minimumRedeemablePoints
  );
  if ('title' in parsedRedeemInput) {
    return {
      message: parsedRedeemInput.message,
      status: 'invalid',
      title: parsedRedeemInput.title,
    };
  }

  const points = parsedRedeemInput.points;
  try {
    const result = await redeemPoints(points);
    const walletCreditMessage = formatNgnCurrency(result.walletCredit ?? 0);

    return {
      points,
      result,
      status: 'success',
      successMessage: `${points} points converted to ${walletCreditMessage} wallet credit.`,
    };
  } catch (error) {
    return {
      alertMessage:
        error instanceof Error
          ? error.message
          : 'Failed to redeem points. Please try again.',
      points,
      status: 'error',
      telemetryMessage:
        error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export function sanitizeWalletFundAmount(value: string): string {
  return value.replace(/\D/g, '');
}

export function validateWalletTopUpAmount(amount: number): string | null {
  if (
    !Number.isFinite(amount) ||
    amount < WALLET_TOP_UP_MIN_AMOUNT ||
    amount > WALLET_TOP_UP_MAX_AMOUNT
  ) {
    return `Wallet top-up amount must be between ₦${WALLET_TOP_UP_MIN_AMOUNT} and ₦${WALLET_TOP_UP_MAX_AMOUNT.toLocaleString()}.`;
  }

  return null;
}

export function getWalletCustomerName(
  customer: CustomerLike | null | undefined,
  user: UserLike | null | undefined
): string {
  return (
    [customer?.first_name, customer?.last_name].filter(Boolean).join(' ') ||
    customer?.email ||
    user?.email ||
    'Customer'
  );
}

export function buildWalletTopUpGatewayParams({
  activeMerchantId,
  activeMerchantSlug,
  amount,
  result,
  userId,
  walletReturnTo,
}: {
  activeMerchantId?: string;
  activeMerchantSlug?: string;
  amount: number;
  result: WalletTopUpResultLike;
  /** The account that started it: the gateway blocks any other (Codex). */
  userId?: string | null;
  walletReturnTo?: string;
}) {
  return {
    amount: String(amount),
    authorizationUrl: result.authorization_url,
    gateway: result.gateway,
    ...(activeMerchantId ? { merchantId: activeMerchantId } : {}),
    ...(activeMerchantSlug ? { merchantSlug: activeMerchantSlug } : {}),
    paymentKind: 'wallet' as const,
    reference: result.reference,
    ...(walletReturnTo ? { returnTo: walletReturnTo } : {}),
    ...(userId ? { userId } : {}),
  };
}

export function parseWalletRedeemPointsInput(
  rawPoints: string,
  minimumRedeemablePoints: number
): { points: number } | { message: string; title: string } {
  const trimmedPoints = rawPoints.trim();
  if (!/^\d+$/.test(trimmedPoints)) {
    return {
      title: 'Invalid Input',
      message: 'Please enter a valid number of points',
    };
  }

  const points = Number(trimmedPoints);
  if (!Number.isSafeInteger(points) || points <= 0) {
    return {
      title: 'Invalid Input',
      message: 'Please enter a valid number of points',
    };
  }

  if (points < minimumRedeemablePoints) {
    return {
      title: 'Invalid Points',
      message: `Minimum redemption is ${minimumRedeemablePoints} points`,
    };
  }

  if (points % minimumRedeemablePoints !== 0) {
    return {
      title: 'Invalid Points',
      message: `Redeem points in ${minimumRedeemablePoints}-point blocks`,
    };
  }

  return { points };
}

export function getWalletLoadingMessage({
  hasMerchantContext,
  hasWalletData,
  isError,
  isLoading,
  user,
}: {
  hasMerchantContext: boolean;
  hasWalletData: boolean;
  isError: boolean;
  isLoading: boolean;
  user: unknown;
}): string | undefined {
  if (!user || !hasMerchantContext) {
    return 'Preparing your wallet...';
  }
  if (!isLoading && isError && !hasWalletData) {
    return 'Unable to load wallet.';
  }
  if (!isLoading && !hasWalletData) {
    return 'Preparing your wallet...';
  }

  return undefined;
}

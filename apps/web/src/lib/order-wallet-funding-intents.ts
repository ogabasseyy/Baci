import type { SupabaseClient } from '@supabase/supabase-js';
import {
  type CustomerWalletPaymentAccount,
  CustomerWalletPaymentAccountError,
  type CustomerWalletPaymentCustomer,
  type CustomerWalletPaymentMerchant,
} from '@/lib/customer-wallet-payment-accounts';
import { logger } from '@/lib/logger';
import type {
  CreateOrderWalletFundingIntentResult,
  OrderWalletFundingIntentRepository,
} from '@/lib/order-wallet-funding-intent-types';
import { getRepository } from '@/lib/order-wallet-funding-repository-access';
import {
  INTENT_TTL_MS,
  isOrderPayable,
  roundMoney,
} from '@/lib/order-wallet-funding-utils';

interface CreateOrderWalletFundingIntentArgs {
  consent?: boolean;
  customer: CustomerWalletPaymentCustomer;
  merchant: CustomerWalletPaymentMerchant;
  now?: Date;
  orderId: string;
  repository?: OrderWalletFundingIntentRepository;
  supabase?: SupabaseClient;
}

type FundingOrder = NonNullable<
  Awaited<ReturnType<OrderWalletFundingIntentRepository['getOrderForCustomer']>>
>;

interface IntentAmounts {
  expectedAmount: number;
  targetOrderAmount: number;
  walletBalance: number;
}

type OrderEligibilityResult =
  | { kind: 'eligible'; amounts: IntentAmounts; order: FundingOrder }
  | {
      kind: 'fallback';
      result: CreateOrderWalletFundingIntentResult;
    };

export { findActiveWalletFundingIntentForTransfer } from '@/lib/order-wallet-funding-intent-matching';
export type {
  CreateOrderWalletFundingIntentResult,
  OrderWalletFundingIntent,
  OrderWalletFundingIntentFallbackCode,
  OrderWalletFundingIntentInsert,
  OrderWalletFundingIntentRepository,
  OrderWalletFundingIntentStatus,
  WalletFundingIntentTransferMatch,
} from '@/lib/order-wallet-funding-intent-types';
export {
  expireStaleWalletFundingIntents,
  getOrderWalletFundingIntent,
  isWalletOrderAutoDebitEnabled,
  markWalletFundingIntentReviewRequired,
} from '@/lib/order-wallet-funding-repository-access';

async function resolveWalletAccount(args: {
  consent?: boolean;
  customer: CustomerWalletPaymentCustomer;
  merchant: CustomerWalletPaymentMerchant;
  now: Date;
  repository: OrderWalletFundingIntentRepository;
}): Promise<CustomerWalletPaymentAccount | null> {
  const account = await args.repository.resolveWalletPaymentAccount({
    customerId: args.customer.id,
    merchantId: args.merchant.id,
  });
  if (account || !args.consent) return account;

  return args.repository.ensureWalletPaymentAccount({
    consentedAt: args.now,
    customer: args.customer,
    merchant: args.merchant,
  });
}

function computeIntentAmounts({
  orderTotal,
  savingsAmount,
  walletBalance,
}: {
  orderTotal: number;
  savingsAmount: number;
  walletBalance: number;
}): IntentAmounts {
  const targetOrderAmount = roundMoney(Math.max(orderTotal - savingsAmount, 0));
  const expectedAmount = roundMoney(
    Math.max(targetOrderAmount - walletBalance, 0)
  );
  return { expectedAmount, targetOrderAmount, walletBalance };
}

async function validateOrderEligibility({
  customerId,
  merchantId,
  orderId,
  repository,
}: {
  customerId: string;
  merchantId: string;
  orderId: string;
  repository: OrderWalletFundingIntentRepository;
}): Promise<OrderEligibilityResult> {
  const order = await repository.getOrderForCustomer({
    customerId,
    merchantId,
    orderId,
  });
  if (!order) {
    return {
      kind: 'fallback',
      result: { code: 'ORDER_NOT_FOUND', kind: 'fallback' },
    };
  }
  if (!isOrderPayable(order.paymentStatus)) {
    return {
      kind: 'fallback',
      result: { code: 'ORDER_NOT_PAYABLE', kind: 'fallback' },
    };
  }

  const alreadyRedeemed = await repository.hasWalletOrderRedemption({
    customerId,
    merchantId,
    orderId,
  });
  if (alreadyRedeemed) {
    return {
      kind: 'fallback',
      result: {
        code: 'ORDER_ALREADY_HAS_WALLET_REDEMPTION',
        kind: 'fallback',
      },
    };
  }

  const savingsAmount = await repository.getSavingsRedeemedAmount(orderId);
  const walletBalance = await repository.getWalletBalance({
    customerId,
    merchantId,
  });
  const amounts = computeIntentAmounts({
    orderTotal: order.total,
    savingsAmount,
    walletBalance,
  });
  if (amounts.targetOrderAmount <= 0) {
    return {
      kind: 'fallback',
      result: { code: 'ORDER_NOT_PAYABLE', kind: 'fallback' },
    };
  }
  if (amounts.expectedAmount <= 0) {
    return {
      kind: 'fallback',
      result: {
        code: 'WALLET_BALANCE_COVERS_ORDER',
        kind: 'fallback',
        targetOrderAmount: amounts.targetOrderAmount,
        walletBalance: amounts.walletBalance,
      },
    };
  }

  return { amounts, kind: 'eligible', order };
}

function getSettingsFallback(
  settings: Awaited<
    ReturnType<OrderWalletFundingIntentRepository['getPaymentSettings']>
  >
): CreateOrderWalletFundingIntentResult | null {
  if (!settings.walletPaystackDvaEnabled) {
    return { code: 'WALLET_DVA_DISABLED', kind: 'fallback' };
  }
  if (!settings.paystackEnabled || !settings.walletOrderAutoDebitEnabled) {
    return { code: 'WALLET_ORDER_AUTO_DEBIT_DISABLED', kind: 'fallback' };
  }
  return null;
}

function normalizeOrderCurrency(currency: string | null | undefined) {
  const normalizedCurrency = currency?.trim().toUpperCase();
  return normalizedCurrency || 'NGN';
}

function createIntentRecord({
  account,
  amounts,
  args,
  now,
  order,
  repository,
}: {
  account: CustomerWalletPaymentAccount;
  amounts: IntentAmounts;
  args: CreateOrderWalletFundingIntentArgs;
  now: Date;
  order: FundingOrder;
  repository: OrderWalletFundingIntentRepository;
}) {
  return repository.insertOrderWalletFundingIntent({
    currency: normalizeOrderCurrency(order.currency),
    customerId: args.customer.id,
    expectedAmount: amounts.expectedAmount,
    expiresAt: new Date(now.getTime() + INTENT_TTL_MS).toISOString(),
    merchantId: args.merchant.id,
    orderId: args.orderId,
    targetOrderAmount: amounts.targetOrderAmount,
    walletBalanceSnapshot: amounts.walletBalance,
    walletPaymentAccountId: account.id,
  });
}

export async function createOrderWalletFundingIntent(
  args: CreateOrderWalletFundingIntentArgs
): Promise<CreateOrderWalletFundingIntentResult> {
  const now = args.now ?? new Date();
  const repository = getRepository(args);
  await repository.expireStaleWalletFundingIntents({
    customerId: args.customer.id,
    merchantId: args.merchant.id,
    now,
  });

  const settings = await repository.getPaymentSettings(args.merchant.id);
  const settingsFallback = getSettingsFallback(settings);
  if (settingsFallback) return settingsFallback;

  const eligibility = await validateOrderEligibility({
    customerId: args.customer.id,
    merchantId: args.merchant.id,
    orderId: args.orderId,
    repository,
  });
  if (eligibility.kind === 'fallback') return eligibility.result;

  let account: CustomerWalletPaymentAccount | null;
  try {
    account = await resolveWalletAccount({ ...args, now, repository });
  } catch (error) {
    if (
      error instanceof CustomerWalletPaymentAccountError &&
      (error.code === 'CUSTOMER_NAME_REQUIRED' ||
        error.code === 'CUSTOMER_PHONE_REQUIRED')
    ) {
      return { code: error.code, kind: 'fallback' };
    }
    logger.error({
      customerId: args.customer.id,
      error,
      merchantId: args.merchant.id,
      message: 'Failed to resolve wallet account for order funding intent',
      orderId: args.orderId,
    });
    return { code: 'WALLET_DVA_SETUP_FAILED', kind: 'fallback' };
  }

  if (!account) {
    return { code: 'WALLET_DVA_CONSENT_REQUIRED', kind: 'fallback' };
  }

  await repository.expireStaleWalletFundingIntents({
    customerId: args.customer.id,
    merchantId: args.merchant.id,
    now,
    walletPaymentAccountId: account.id,
  });

  const existingIntent = await repository.findActiveOrderIntent({
    orderId: args.orderId,
  });
  if (existingIntent)
    return { account, intent: existingIntent, kind: 'intent' };

  const intent = await createIntentRecord({
    account,
    amounts: eligibility.amounts,
    args,
    now,
    order: eligibility.order,
    repository,
  });

  return { account, intent, kind: 'intent' };
}

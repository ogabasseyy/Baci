import type {
  CustomerWalletPaymentAccount,
  CustomerWalletPaymentCustomer,
  CustomerWalletPaymentMerchant,
} from '@/lib/customer-wallet-payment-accounts';

export type WalletFundingPaymentProvider = 'paystack';

export type OrderWalletFundingIntentStatus =
  | 'pending'
  | 'underfunded'
  | 'funded'
  | 'processing'
  | 'completed'
  | 'expired'
  | 'cancelled'
  | 'review_required'
  | 'failed';

export interface OrderWalletFundingIntent {
  createdAt: string;
  currency: string;
  customerId: string;
  debitedAmount: number;
  excessAmount: number;
  expectedAmount: number;
  expiresAt: string;
  fundedAmount: number;
  id: string;
  idempotencyKey: string;
  lastGatewayReference: string | null;
  lastTransactionId: string | null;
  merchantId: string;
  orderId: string;
  provider: WalletFundingPaymentProvider;
  status: OrderWalletFundingIntentStatus;
  targetOrderAmount: number;
  walletBalanceSnapshot: number;
  walletPaymentAccountId: string;
}

export interface OrderWalletFundingIntentInsert {
  currency: string;
  customerId: string;
  expectedAmount: number;
  expiresAt: string;
  merchantId: string;
  orderId: string;
  targetOrderAmount: number;
  walletBalanceSnapshot: number;
  walletPaymentAccountId: string;
}

export interface OrderWalletFundingPaymentSettings {
  paystackEnabled: boolean;
  walletOrderAutoDebitEnabled: boolean;
  walletPaystackDvaEnabled: boolean;
}

export interface OrderWalletFundingOrder {
  currency: string;
  customerId: string;
  id: string;
  merchantId: string;
  paymentStatus: string;
  total: number;
}

export interface OrderWalletFundingIntentRepository {
  ensureWalletPaymentAccount(args: {
    consentedAt: Date;
    customer: CustomerWalletPaymentCustomer;
    merchant: CustomerWalletPaymentMerchant;
  }): Promise<CustomerWalletPaymentAccount>;
  expireStaleWalletFundingIntents(args: {
    customerId?: string;
    merchantId?: string;
    now: Date;
    walletPaymentAccountId?: string;
  }): Promise<void>;
  findActiveOrderIntent(args: {
    orderId: string;
  }): Promise<OrderWalletFundingIntent | null>;
  findActiveWalletAccountIntents(args: {
    walletPaymentAccountId: string;
  }): Promise<OrderWalletFundingIntent[]>;
  /**
   * Returns the intent that already recorded a payment for this transfer
   * reference (any status), or null. Makes transfer→intent routing
   * idempotent across webhook retries.
   */
  findWalletAccountIntentByTransferReference(args: {
    gatewayReference: string;
    walletPaymentAccountId: string;
  }): Promise<OrderWalletFundingIntent | null>;
  getOrderForCustomer(args: {
    customerId: string;
    merchantId: string;
    orderId: string;
  }): Promise<OrderWalletFundingOrder | null>;
  getOrderWalletFundingIntent(args: {
    customerId: string;
    id: string;
    merchantId: string;
  }): Promise<OrderWalletFundingIntent | null>;
  getPaymentSettings(
    merchantId: string
  ): Promise<OrderWalletFundingPaymentSettings>;
  getSavingsRedeemedAmount(orderId: string): Promise<number>;
  getWalletBalance(args: {
    customerId: string;
    merchantId: string;
  }): Promise<number>;
  hasWalletOrderRedemption(args: {
    customerId: string;
    merchantId: string;
    orderId: string;
  }): Promise<boolean>;
  insertOrderWalletFundingIntent(
    payload: OrderWalletFundingIntentInsert
  ): Promise<OrderWalletFundingIntent>;
  markWalletFundingIntentReviewRequired(args: {
    gatewayReference: string;
    intentIds: string[];
    reason: string;
  }): Promise<void>;
  resolveWalletPaymentAccount(args: {
    customerId: string;
    merchantId: string;
  }): Promise<CustomerWalletPaymentAccount | null>;
}

export type OrderWalletFundingIntentFallbackCode =
  | 'CUSTOMER_NAME_REQUIRED'
  | 'CUSTOMER_PHONE_REQUIRED'
  | 'ORDER_ALREADY_HAS_WALLET_REDEMPTION'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_NOT_PAYABLE'
  | 'WALLET_BALANCE_COVERS_ORDER'
  | 'WALLET_DVA_CONSENT_REQUIRED'
  | 'WALLET_DVA_DISABLED'
  | 'WALLET_DVA_SETUP_FAILED'
  | 'WALLET_ORDER_AUTO_DEBIT_DISABLED';

export type CreateOrderWalletFundingIntentResult =
  | {
      account: CustomerWalletPaymentAccount;
      intent: OrderWalletFundingIntent;
      kind: 'intent';
    }
  | {
      code: Exclude<
        OrderWalletFundingIntentFallbackCode,
        'WALLET_BALANCE_COVERS_ORDER'
      >;
      kind: 'fallback';
    }
  | {
      code: 'WALLET_BALANCE_COVERS_ORDER';
      kind: 'fallback';
      targetOrderAmount: number;
      walletBalance: number;
    };

export type WalletFundingIntentTransferMatch =
  | { intent: OrderWalletFundingIntent; kind: 'match' }
  | { kind: 'none' }
  | { intentIds: string[]; kind: 'ambiguous' };

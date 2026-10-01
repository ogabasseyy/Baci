/**
 * Platform summary metrics for the selected admin window.
 * Monetary fields are reported only for the explicit reporting currency.
 */
export interface PlatformSummary {
  /** Paid GMV only for the selected window. */
  totalGmv: number;
  /** Gross order value across all orders in the selected window, regardless of payment state. */
  grossGmv: number;
  /** The only currency included in monetary platform aggregates. */
  reportingCurrency: 'NGN';
  /** Orders excluded from NGN money metrics because their currency is non-NGN or unknown. */
  excludedNonNgnOrUnknownGrossOrders: number;
  /** Paid orders excluded from NGN money metrics because their currency is non-NGN or unknown. */
  excludedNonNgnOrUnknownPaidOrders: number;
  gmvChange: number;
  /** Merchants whose owners or active staff logged in or refreshed a session during the selected window. */
  activeMerchants: number;
  activeMerchantChange: number;
  /** Merchants with at least one paid order in the selected window. */
  sellingMerchants: number;
  totalMerchants: number;
  /** Paid order count only for the selected window. */
  totalOrders: number;
  /** Gross order count across all orders in the selected window, regardless of payment state. */
  grossOrders: number;
  /** Percentage change in paid order count versus the immediately preceding matching window, on a 0-100 scale. */
  orderChange: number;
  /** Average value of paid orders in the selected window, calculated as paid GMV divided by paid order count. */
  avgOrderValue: number;
  /** Percentage change in paid-order average order value versus the immediately preceding matching window, on a 0-100 scale. */
  aovChange: number;
  /** Paid GMV divided by merchants with paid orders in the selected window. */
  avgGmvPerMerchant: number;
  /** Unavailable platform-wide: the settlement ledger has no currency code. */
  recordedPlatformFees: number | null;
  /** Unavailable platform-wide: the settlement ledger has no currency code. */
  recordedProcessorFees: number | null;
  /** Unavailable platform-wide: the settlement ledger has no currency code. */
  recordedMerchantNet: number | null;
}

export interface MerchantHealthBreakdown {
  /** Paid sale in the last 30 days. Legacy API key retained for compatibility. */
  healthy: number;
  /** Last paid sale 31-90 days ago. Legacy API key retained for compatibility. */
  atRisk: number;
  /** Last paid sale over 90 days ago. This does not assert subscription churn. */
  churned: number;
  /** No paid sale since Baci's analytics launch date (18 December 2025, Africa/Lagos). */
  new: number;
}

export interface GrowthMetrics {
  /** Merchants created in the current Africa/Lagos calendar month. */
  newMerchantsThisMonth: number;
  /** Current Africa/Lagos calendar-month sign-ups versus the preceding calendar month. */
  merchantGrowthRate: number;
  /** Selected rolling reporting window versus its immediately preceding matching window; not meaningful for the all-time view. */
  gmvGrowthRate: number;
}

export interface TopMerchant {
  id: string;
  name: string;
  gmv: number;
  orders: number;
}

export interface DailyGmvData {
  date: string;
  gmv: number;
  orders: number;
  merchants: number;
}

export interface SalesChannelBreakdown {
  channel: string;
  gmv: number;
  orders: number;
  /** Percentage share of paid GMV, expressed on a 0-100 scale. */
  shareOfGmv: number;
  /** Percentage share of paid orders, expressed on a 0-100 scale. */
  shareOfOrders: number;
}

export interface MerchantActivationStage {
  key: string;
  label: string;
  merchants: number;
  /** Percentage of merchants in this stage, expressed on a 0-100 scale. */
  completionRate: number;
  description: string;
}

export interface BusinessTypeBreakdown {
  businessType: string;
  classification: 'configured' | 'invalid' | 'unspecified';
  label: string;
  merchants: number;
  rawValues: string[];
  shareOfMerchants: number;
}

export interface SignupSourceBreakdown {
  source: 'web' | 'ios' | 'android';
  merchants: number;
  shareOfMerchants: number;
}

export interface OrderStatusBreakdown {
  /** Raw status key from the order record. */
  status: string;
  /** Human-friendly status label for UI display. */
  label: string;
  /** Number of orders currently in this status. */
  orders: number;
  /** Gross order value in the NGN reporting currency; counts include all currencies. */
  amount: number;
  /** Percentage of orders in this status, expressed on a 0-100 scale. */
  shareOfOrders: number;
  /** Percentage of gross order value in this status, expressed on a 0-100 scale. */
  shareOfAmount: number;
}

export interface PaymentMethodBreakdown {
  /** Raw payment method key from the order record. */
  method: string;
  /** Human-friendly method label for UI display. */
  label: string;
  /** Number of paid orders captured with this method. */
  orders: number;
  /** Paid GMV attributed to this method in the admin display currency. */
  amount: number;
  /** Percentage of paid orders for this method, expressed on a 0-100 scale. */
  shareOfPaidOrders: number;
  /** Percentage of paid GMV for this method, expressed on a 0-100 scale. */
  shareOfPaidAmount: number;
}

export interface PlatformAnalytics {
  summary: PlatformSummary;
  merchantHealth: MerchantHealthBreakdown;
  growth: GrowthMetrics;
  topMerchants: TopMerchant[];
  dailyGmv: DailyGmvData[];
  salesByChannel: SalesChannelBreakdown[];
  paymentStatuses: OrderStatusBreakdown[];
  shippingStatuses: OrderStatusBreakdown[];
  paymentMethods: PaymentMethodBreakdown[];
  merchantActivation: MerchantActivationStage[];
  businessTypes: BusinessTypeBreakdown[];
  signupSources: SignupSourceBreakdown[];
  generatedAt: string;
}

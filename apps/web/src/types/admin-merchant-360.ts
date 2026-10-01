export type AdminMerchantMoneyStatusSummary = {
  pendingCount: number;
  pendingAmount: number | null;
  failedCount: number;
  failedAmount: number | null;
};

export type AdminMerchantCurrencylessSettlementSummary = {
  currency: null;
  pendingCount: number;
  pendingAmount: null;
  failedCount: number;
  failedAmount: null;
  settledCount: number;
  settledAmount: null;
};

export type AdminMerchant360Response = {
  generatedAt: string;
  moneyCurrency: string;
  merchant: {
    id: string;
    businessName: string | null;
    slug: string | null;
    signupSource: string | null;
    planTier: string | null;
    isPublished: boolean | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  domain: {
    hasPrimary: boolean;
    primaryDomain: string | null;
    status: string | null;
    sslStatus: string | null;
    verifiedAt: string | null;
  };
  readiness: {
    hasStorefrontSlug: boolean;
    isPublished: boolean;
    paymentConfigured: boolean;
    shippingConfigured: boolean;
    storefrontReady: boolean;
  };
  summary: {
    webUsers: number;
    staffUsers: number;
    customerUsers: number;
    activeAdminAppInstallations: number;
    activeStorefrontAppInstallations: number;
    unmatchedAppUsers: number;
  };
  staffAccess: Array<{ role: string; status: string; users: number }>;
  sales: {
    paidGmv: number;
    /** Paid-order count across every recorded order currency. */
    paidOrders: number;
    displayCurrencyPaidOrders: number;
    excludedNonDisplayCurrencyPaidOrders: number;
    lastPaidAt: string | null;
  };
  /** The settlement ledger does not persist currency, so values are withheld. */
  settlements: AdminMerchantCurrencylessSettlementSummary;
  payouts: AdminMerchantMoneyStatusSummary & {
    completedCount: number;
    completedAmount: number | null;
  };
  incidents: {
    domainEventFailures30d: number;
    eventDeliveryDeadLetters30d: number;
    shipmentFailures30d: number;
  };
  recentAuditEvents: Array<{
    action: string;
    resourceType: string;
    changedFields: string[];
    occurredAt: string;
  }>;
};

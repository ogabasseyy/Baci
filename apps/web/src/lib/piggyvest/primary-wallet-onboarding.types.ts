export interface PrimaryWalletIntentScope {
  merchantId: string;
  customerId: string;
  userId: string;
  integrationId: string;
  businessId: string;
  environment: 'staging' | 'production';
}

export type PrimaryWalletClaim =
  | { status: 'claimed'; intentId: string; claimToken: string }
  | { status: 'pending' | 'ready' | 'conflict' };

export interface PrimaryWalletOnboardingStorage {
  claim(
    input: PrimaryWalletIntentScope & { requestFingerprint: string }
  ): Promise<PrimaryWalletClaim>;
  recordAccepted(
    input: PrimaryWalletIntentScope & {
      intentId: string;
      claimToken: string;
      providerCustomerId: string;
      providerWalletId: string;
    }
  ): Promise<boolean>;
  recordUncertain(
    input: PrimaryWalletIntentScope & {
      intentId: string;
      claimToken: string;
    }
  ): Promise<void>;
}

export interface PrimaryWalletCustomerRequest {
  bvn: string;
  email: string;
  name: string;
  phone: string;
  third_party_identifier: string;
  enable_interest_accrual: false;
}

export interface PrimaryWalletIntentScope {
  merchantId: string;
  customerId: string;
  userId: string;
  integrationId: string;
  businessId: string;
  environment: 'staging' | 'production';
}

export type PrimaryWalletClaim =
  | {
      status: 'claimed';
      intentId: string;
      claimToken: string;
      reclaimed?: boolean;
    }
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
  /** Created, routing not proven yet: ids kept, never usable. */
  recordRoutingPending(
    input: PrimaryWalletIntentScope & {
      intentId: string;
      claimToken: string;
      providerCustomerId: string;
      providerWalletId: string;
    }
  ): Promise<boolean>;
  recordRejected(
    input: PrimaryWalletIntentScope & {
      intentId: string;
      claimToken: string;
    }
  ): Promise<void>;
  releaseIntent(
    input: PrimaryWalletIntentScope & {
      intentId: string;
      claimToken: string;
    }
  ): Promise<boolean>;
}

export interface PrimaryWalletCustomerRequest {
  bvn: string;
  email: string;
  name: string;
  phone: string;
  third_party_identifier: string;
  // Main-wallet interest is routed to the configured Ogabassey wallet at
  // creation; PiggyVest does not allow changing it afterwards.
  enable_interest_accrual: true;
  interest_payout_wallet: string;
}

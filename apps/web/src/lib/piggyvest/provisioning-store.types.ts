export type PiggyvestProvisioningIdentity = {
  kind: 'create_customer' | 'create_plan_wallet';
  merchantId: string;
  customerId: string;
  goalId: string | null;
  providerCustomerId: string | null;
  requestFingerprint: string;
};

export type PiggyvestProvisioningStore = {
  prepare(input: PiggyvestProvisioningIdentity): Promise<{
    intentId: string;
    outcome: 'accepted' | 'duplicate' | 'conflict';
    status: 'pending' | 'dispatched' | 'unknown' | 'awaiting_confirmation';
  }>;
  claim(
    intentId: string,
    input: PiggyvestProvisioningIdentity
  ): Promise<string | null>;
  record(input: {
    intentId: string;
    claimToken: string;
    resultCode: 'accepted' | 'ambiguous';
    newCustomer?: true;
    providerCustomerId: string | null;
    providerWalletId: string | null;
  }): Promise<'awaiting_confirmation' | 'unknown' | 'stale'>;
};

export type PiggyvestProvisioningExecutor = (
  statement: string,
  parameters: readonly unknown[]
) => Promise<{ rows: unknown[] }>;

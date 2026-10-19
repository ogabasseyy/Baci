import 'server-only';
import { createHmac } from 'node:crypto';
import { piggyvestProvisioningCommandSchema } from '@/schemas/piggyvest-provisioning-command';
import { piggyvestProvisioningConfigurationSchema } from '@/schemas/piggyvest-provisioning-configuration';
import { buildPiggyvestPlanWalletName } from './plan-wallet-name';

export function buildPiggyvestProvisioningRequest({
  configuration,
  command,
}: {
  configuration: unknown;
  command: unknown;
}): {
  kind: 'create_customer' | 'create_plan_wallet';
  merchantId: string;
  customerId: string;
  goalId: string | null;
  providerCustomerId: string | null;
  path: '/api/v1/customers' | '/api/v1/wallet/sub-account';
  body: string;
  requestFingerprint: string;
} {
  const config =
    piggyvestProvisioningConfigurationSchema.safeParse(configuration);
  const parsed = piggyvestProvisioningCommandSchema.safeParse(command);
  if (!config.success || !parsed.success) {
    throw new Error('PiggyVest provisioning unavailable');
  }
  const input = parsed.data;
  if (
    input.merchantId !== config.data.expectedMerchantId ||
    !config.data.allowlistedCustomerIds.includes(input.customerId) ||
    (input.enableInterestAccrual &&
      input.interestPayout === 'own_wallet' &&
      !config.data.defaultInterestRoutingVerified) ||
    (input.interestPayout === 'configured_destination' &&
      !config.data.verifiedInterestPayoutWalletId)
  ) {
    throw new Error('PiggyVest provisioning unavailable');
  }
  const interest = {
    enable_interest_accrual: input.enableInterestAccrual,
    ...(input.interestPayout === 'configured_destination'
      ? { interest_payout_wallet: config.data.verifiedInterestPayoutWalletId }
      : {}),
  };
  const path =
    input.kind === 'create_customer'
      ? '/api/v1/customers'
      : '/api/v1/wallet/sub-account';
  const goalId = input.kind === 'create_plan_wallet' ? input.goalId : null;
  const body = JSON.stringify(
    input.kind === 'create_customer'
      ? {
          bvn: input.bvn,
          email: input.email,
          name: input.name,
          phone: input.phone,
          third_party_identifier: `baci:${config.data.integrationId}:${input.customerId}`,
          ...interest,
        }
      : {
          subaccount_name: buildPiggyvestPlanWalletName({
            integrationId: config.data.integrationId,
            goalId: input.goalId,
            customerName: input.customerName,
          }),
          customer_id: input.providerCustomerId,
          reserve_virtual_account: input.reserveVirtualAccount,
          ...interest,
        }
  );
  const requestFingerprint = createHmac('sha256', config.data.fingerprintKey)
    .update(
      JSON.stringify({
        integrationId: config.data.integrationId,
        businessId: config.data.expectedBusinessId,
        merchantId: input.merchantId,
        customerId: input.customerId,
        goalId,
        kind: input.kind,
        path,
        body,
      })
    )
    .digest('hex');
  return {
    kind: input.kind,
    merchantId: input.merchantId,
    customerId: input.customerId,
    goalId,
    path,
    body,
    requestFingerprint,
    providerCustomerId:
      input.kind === 'create_plan_wallet' ? input.providerCustomerId : null,
  };
}

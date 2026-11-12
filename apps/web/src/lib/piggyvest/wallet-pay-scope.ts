import type { WalletPayRuntime } from './wallet-pay-runtime';

/**
 * The customer scope every wallet pay customer-side call carries: who the
 * database re-checks (assert_savings_scope) at each transition. Built only
 * from the server runtime and a verified identity, never from the request.
 */
export function walletPayScope(
  runtime: Pick<WalletPayRuntime, 'configuration' | 'businessId'>,
  identity: { merchantId: string; customerId: string; userId: string }
) {
  return {
    merchantId: identity.merchantId,
    customerId: identity.customerId,
    userId: identity.userId,
    integrationId: runtime.configuration.integrationId,
    environment: runtime.configuration.environment,
    businessId: runtime.businessId,
  };
}

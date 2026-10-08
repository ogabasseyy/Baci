import 'server-only';
import type { PiggyvestClientConfig } from './client';
import { createPiggyvestCustomer } from './customers';
import type { PrimaryWalletCustomerRequest } from './primary-wallet-onboarding.types';

export async function createPrimaryWalletProviderCustomer(
  config: PiggyvestClientConfig,
  request: PrimaryWalletCustomerRequest
) {
  return await createPiggyvestCustomer(config, {
    bvn: request.bvn,
    email: request.email,
    name: request.name,
    phone: request.phone,
    thirdPartyIdentifier: request.third_party_identifier,
    enableInterestAccrual: request.enable_interest_accrual,
    returnIfExist: true,
  });
}

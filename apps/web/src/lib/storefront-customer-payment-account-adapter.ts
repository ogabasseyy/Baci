import type { OrderPaymentAccountLike } from '@baci/shared';
import type { StorefrontCustomerPaymentAccount } from './storefront-customer-payment-accounts';

export function toOrderPaymentAccount(
  account: StorefrontCustomerPaymentAccount
): OrderPaymentAccountLike {
  return {
    account_name: account.account_name,
    account_number: account.account_number,
    assignment_customer_email_source: account.assignment_customer_email_source,
    assigned_at: account.assigned_at,
    bank_name: account.bank_name,
    created_at: account.created_at,
    expires_at: account.expires_at,
    provider: account.provider,
  };
}

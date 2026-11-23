import { NextRequest } from 'next/server';
import type { CustomerWalletPaymentAccount } from '@/lib/customer-wallet-payment-accounts';

export const walletAccount: CustomerWalletPaymentAccount = {
  accountName: 'Ogabassey/Jane Doe',
  accountNumber: '1234567890',
  bankName: 'Titan Paystack',
  bankSlug: 'titan-paystack',
  consentedAt: '2026-05-21T10:00:00.000Z',
  currency: 'NGN',
  customerId: 'customer-1',
  id: 'wallet-account-1',
  merchantId: 'merchant-1',
  metadata: {},
  provider: 'paystack',
  providerAccountId: '99',
  providerCustomerCode: 'CUS_123',
  providerSubaccountCode: 'ACCT_merchant123',
  status: 'active',
};

export const merchant = {
  business_name: 'Ogabassey',
  id: 'merchant-1',
  paystack_subaccount_code: 'ACCT_merchant123',
  slug: 'ogabassey',
};

export const customer = {
  email: 'jane@example.com',
  first_name: 'Jane',
  id: 'customer-1',
  last_name: 'Doe',
  phone: '+2348012345678',
  user_id: 'user-1',
};

export function getRequest(url: string) {
  return new NextRequest(url);
}

export function postRequest(body: Record<string, unknown>) {
  return new NextRequest(
    'http://localhost:3000/api/storefront/customer/wallet/funding-account',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );
}

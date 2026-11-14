import type { SupabaseClient } from '@supabase/supabase-js';

export const buyer = {
  email: 'buyer@example.com',
  first_name: 'Ada',
  last_name: 'Lovelace',
  phone_number: '+2348012345678',
};
export const session = {
  cart_items: [{ id: 'product-1', quantity: 1 }],
  currency: 'NGN',
  id: 'row-1',
  merchant_id: 'merchant-1',
  metadata: null,
  order_id: null,
  payment_reference: null,
  session_id: 'agentic_session_1',
  shipping_address: { city: 'Lagos' },
  shipping_method: 'pickup_store_1',
  status: 'processing' as const,
  virtual_account_number: null,
};

export const sessionCalc = {
  lineItems: [
    {
      id: 'line_product-1',
      item: {
        id: 'product-1',
        product_id: 'product-1',
        quantity: 1,
        title: 'Phone',
      },
      base_amount: 500_000,
      discount: 0,
      subtotal: 500_000,
      tax: 0,
      total: 500_000,
    },
  ],
  totals: [
    { type: 'total' as const, display_text: 'Total Due', amount: 500_000 },
  ],
  fulfillmentOptions: [],
  selectedOptionId: 'pickup_store_1',
  messages: [],
};

export const dvaAccount = {
  account_name: 'Ada Lovelace',
  account_number: '1234567890',
  bank_name: 'Paystack-Titan',
};
const authorizationInput = {
  authorizationSecrets: ['confirmation-secret'],
  completionAuthorization: {
    currency: 'NGN',
    expires_at: '2999-01-01T00:00:00.000Z',
    mandate_id: 'mandate-1',
    max_amount: 500_000,
    session_id: 'agentic_session_1',
    signature:
      '314fa3c91a884f9f2326b44a666192f0f93ef3a638ea32c485bc8aadb6bef738',
    type: 'payment_mandate' as const,
  },
};

export function paymentInput(overrides: Record<string, unknown> = {}) {
  return {
    ...authorizationInput,
    buyer,
    canResumePaymentAccount: false,
    merchantId: 'merchant-1',
    metadata: { agentic: { line_items: [] } },
    paystackSubaccountCode: 'ACCT_TESTMOCK1234567',
    session,
    sessionCalc,
    sessionId: 'agentic_session_1',
    storedDvaAccount: null,
    supabase: {} as SupabaseClient,
    ...overrides,
  };
}

import { createHmac, randomBytes } from 'node:crypto';

export const completionConfirmationSecret = randomBytes(32).toString('hex');

export function validHumanConfirmation(amount = 500000) {
  const confirmedAt = new Date().toISOString();
  const payload = JSON.stringify({
    amount,
    confirmed_at: confirmedAt,
    currency: 'NGN',
    session_id: 'agentic_session_1',
    type: 'human_confirmation',
  });
  return {
    amount,
    confirmed_at: confirmedAt,
    currency: 'NGN',
    session_id: 'agentic_session_1',
    signature: createHmac('sha256', completionConfirmationSecret)
      .update(payload)
      .digest('hex'),
    type: 'human_confirmation',
  };
}

export function makeReadySession() {
  return {
    id: 'row-1',
    session_id: 'agentic_session_1',
    merchant_id: 'merchant-1',
    cart_items: [{ id: 'product-1', quantity: 1 }],
    shipping_method: 'pickup_store_1',
    shipping_address: { city: 'Lagos' },
    currency: 'NGN',
    status: 'processing',
    order_id: null,
    payment_reference: null,
    virtual_account_bank: null,
    virtual_account_name: null,
    virtual_account_number: null,
    metadata: { agentic: { existing: true } },
  };
}

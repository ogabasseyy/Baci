/** Initialize payment through the server-side payment initialization route. */
export async function initializeCardPayment(
  merchantId: string,
  orderId: string,
  currency: string,
  email: string,
  name: string,
  phone: string,
  gateway: string,
  billingAddress: {
    line1: string;
    city: string;
    state?: string;
    country: string;
    zip_code: string;
  }
) {
  const res = await fetch('/api/payments/initialize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      merchant_id: merchantId,
      order_id: orderId,
      currency,
      customer_email: email,
      customer_name: name,
      customer_phone: phone,
      gateway,
      billing_address: billingAddress,
    }),
  });

  if (!res.ok) {
    const errorData = await res.json();
    throw new Error(errorData.error || 'Payment initialization failed');
  }

  const result = await res.json();
  if (!result.success) {
    throw new Error('Payment initialization failed');
  }
  return result;
}

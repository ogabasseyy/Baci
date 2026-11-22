export const validOrder = {
  merchant_id: '123e4567-e89b-12d3-a456-426614174000',
  customer_email: 'test@example.com',
  customer_name: 'John Doe',
  customer_phone: '+234 800 123 4567',
  items: [
    {
      name: 'Test Product',
      quantity: 1,
      price: 1000,
      productId: 'prod-1',
    },
  ],
  subtotal: 1000,
  payment_method: 'card',
};

import type { CartItem } from '../../src/hooks/cart';
import type { MerchantData } from '../../src/hooks/merchant/types';

export const merchant: MerchantData = {
  id: '11111111-1111-4111-8111-111111111111',
  user_id: '22222222-2222-4222-8222-222222222222',
  slug: 'ogabassey',
  business_name: 'Checkout browser fixture',
  business_type: 'electronics',
  country: 'NG',
  payout_currency: 'NGN',
  paystack_subaccount_configured: true,
  vat_registration_status: 'registered',
  vat_rate: 7.5,
};
export const cartItem: CartItem = {
  id: '33333333-3333-4333-8333-333333333333',
  cartItemId: '33333333-3333-4333-8333-333333333333',
  name: 'Checkout test phone',
  description: 'Deterministic browser fixture',
  price: 100000,
  quantity: 1,
  status: 'active',
  manage_stock: false,
  stock: 10,
  image: '/phone.svg',
  imageLarge: '/phone.svg',
  imageHint: 'Phone',
  brand: 'Fixture',
  gtin: '',
  mpn: '',
};
export const contact = {
  firstName: 'Ada',
  lastName: 'Okon',
  customerEmail: 'ada@example.test',
  customerPhone: '+2348031234567',
};

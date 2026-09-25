import type { Page } from '@playwright/test';
import { cartItem, contact } from './fixtures';

export async function seedCheckout(
  page: Page,
  options: { authenticated?: boolean; emptyCart?: boolean } = {}
) {
  await page.addInitScript(
    ({ item, details, emptyCart }) => {
      if (!localStorage.getItem('baci-cart-ogabassey-guest')) {
        localStorage.setItem(
          'baci-cart-ogabassey-guest',
          JSON.stringify(emptyCart ? [] : [item])
        );
      }
      if (!sessionStorage.getItem('checkout-form'))
        sessionStorage.setItem(
          'checkout-form',
          JSON.stringify({
            ...details,
            currentStep: 'payment',
            completedSteps: { contact: true, delivery: true },
            newAddressState: 'Lagos',
            newAddressCity: 'Ikeja',
            deliveryMethod: 'pickup',
          })
        );
    },
    { item: cartItem, details: contact, emptyCart: Boolean(options.emptyCart) }
  );
  if (options.authenticated)
    await page.route('**/api/storefront/auth/session?**', (route) =>
      route.fulfill({ json: { authenticated: true } })
    );
}
export const order = {
  id: '44444444-4444-4444-8444-444444444444',
  order_number: 'TEST-1001',
  short_id: 'TEST-1001',
  subtotal: 100000,
  total: 107500,
  tax_amount: 7500,
  shipping_fee: 0,
  currency: 'NGN',
  payment_status: 'unpaid',
  shipping_status: 'pending',
  payment_method: 'card',
  tracking_token: 'fixture-tracking-token',
  customer_name: 'Ada Okon',
  customer_email: contact.customerEmail,
  customer_phone: contact.customerPhone,
  shipping_address: {
    address: 'Store Pickup',
    city: 'Ikeja',
    state: 'Lagos',
    phone: contact.customerPhone,
  },
  items: [
    {
      id: cartItem.id,
      product_id: cartItem.id,
      product_name: cartItem.name,
      price: cartItem.price,
      quantity: 1,
      image_url: cartItem.image,
    },
  ],
};

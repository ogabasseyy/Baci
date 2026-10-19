import { afterEach, expect, it, vi } from 'vitest';
import { analytics } from './analytics';

afterEach(() => {
  localStorage.clear();
  delete window.fbq;
});

it('sends parent product IDs as groups without changing the value', () => {
  localStorage.setItem(
    'baci-cookie-consent',
    JSON.stringify({ analytics: true })
  );
  window.fbq = vi.fn();
  analytics.viewItem(
    {
      id: 'phone',
      name: 'Phone',
      price: 891000,
      description: '',
      status: 'active',
      manage_stock: false,
      stock: 0,
      image: '',
      imageLarge: '',
      imageHint: '',
      brand: 'Apple',
      gtin: '',
      mpn: '',
    },
    'NGN'
  );
  expect(window.fbq).toHaveBeenCalledWith(
    'track',
    'ViewContent',
    expect.objectContaining({
      content_ids: ['phone'],
      content_type: 'product_group',
      value: 891000,
    })
  );
});

it('keeps the consent gate for catalog matching events', () => {
  window.fbq = vi.fn();
  analytics.pageView('/');
  expect(window.fbq).not.toHaveBeenCalled();
});

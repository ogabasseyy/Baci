import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import XAdsIntegrationClient from './client-page';

const mocks = vi.hoisted(() => ({ merchant: vi.fn(), save: vi.fn() }));
vi.mock('@/hooks/use-merchant-client', () => ({ useMerchant: mocks.merchant }));
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf: mocks.save }));
const initial = {
  pixelId: 'abc',
  eventIds: { purchase: 'tw-abc-paid' },
  capiConfigured: true,
};
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});
it('keeps credentials masked and omits empty credential fields from a browser-only update', async () => {
  mocks.merchant.mockReturnValue({ merchant: { id: 'merchant-a' } });
  mocks.save.mockResolvedValue(Response.json(initial));
  render(
    <XAdsIntegrationClient
      initialMerchantId="merchant-a"
      initialConnection={initial}
    />
  );
  expect(screen.getByLabelText('API key secret')).toHaveAttribute(
    'type',
    'password'
  );
  expect(screen.getByLabelText('API key secret')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Save connection' }));
  await waitFor(() =>
    expect(screen.getByRole('status')).toHaveTextContent('saved')
  );
  expect(mocks.save).toHaveBeenCalledWith(
    '/api/integrations/x-ads?merchantId=merchant-a',
    expect.anything()
  );
  const body = JSON.parse(mocks.save.mock.calls[0][1].body);
  expect(body).not.toHaveProperty('credentials');
  expect(body.eventIds).toEqual({ purchase: 'tw-abc-paid' });
});
it('clears typed credentials and old event mappings when switching merchant', async () => {
  mocks.merchant.mockReturnValue({ merchant: { id: 'merchant-a' } });
  const next = {
    pixelId: 'xyz',
    eventIds: { addToCart: 'tw-xyz-cart' },
    capiConfigured: false,
  };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(next)));
  const view = render(
    <XAdsIntegrationClient
      initialMerchantId="merchant-a"
      initialConnection={initial}
    />
  );
  fireEvent.change(screen.getByLabelText('API key secret'), {
    target: { value: 'typed-secret-for-a' },
  });
  mocks.merchant.mockReturnValue({ merchant: { id: 'merchant-b' } });
  view.rerender(
    <XAdsIntegrationClient
      initialMerchantId="merchant-a"
      initialConnection={initial}
    />
  );
  await waitFor(() =>
    expect(screen.getByLabelText('Pixel ID')).toHaveValue('xyz')
  );
  expect(screen.getByLabelText('API key secret')).toHaveValue('');
  expect(screen.getByLabelText('Successful payment')).toHaveValue('');
  expect(screen.getByLabelText('Add to cart')).toHaveValue('tw-xyz-cart');
});

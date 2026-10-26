import { render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import {
  catalog,
  home,
  merchant,
} from '../../../tools/builder-preview-spike/fixtures';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  products: vi.fn(),
}));
vi.mock('@/config/builder-private-storage', () => ({
  BUILDER_PRIVATE_STORAGE_ENABLED: true,
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({ merchant, basePath: '' }),
}));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ rpc: mocks.rpc, from: mocks.from }),
}));
vi.mock('@/lib/api-client', () => ({ apiGet: mocks.products }));
vi.mock('@/components/builder/config', () => ({ builderConfig: {} }));
vi.mock('@puckeditor/core', () => ({ Render: () => null }));

import { PuckStorefront } from './puck-storefront';

it('binds actual rendered config and publication marker to one atomic RPC result', async () => {
  const version = `published:${merchant.id}`;
  mocks.rpc.mockResolvedValue({
    data: { config: home, publishedVersion: version },
    error: null,
  });
  mocks.products.mockResolvedValue({
    products: catalog.products.map((product) => ({
      ...product,
      status: 'active',
    })),
  });
  const { container } = render(<PuckStorefront />);
  await screen.findByRole('heading', { name: 'Our cameras' });
  await waitFor(() =>
    expect(
      container.querySelector('[data-baci-published-version]')
    ).toHaveAttribute('data-baci-published-version', version)
  );
  expect(
    container
      .querySelector('[data-baci-content-digest]')
      ?.getAttribute('data-baci-content-digest')
  ).toMatch(/^home-v1:[a-f0-9]{64}$/);
  expect(mocks.rpc).toHaveBeenCalledTimes(1);
  expect(mocks.rpc).toHaveBeenCalledWith(
    'builder_public_home',
    { p_merchant: merchant.id },
    { get: true }
  );
  expect(mocks.from).not.toHaveBeenCalled();
});

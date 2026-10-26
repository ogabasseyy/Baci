import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  catalog,
  home,
  merchant,
} from '../../../tools/builder-preview-spike/fixtures';
import { PuckStorefront } from './puck-storefront';

const mocks = vi.hoisted(() => ({
  identity: {} as Record<string, unknown>,
  config: {} as unknown,
  legacy: vi.fn(),
  get: vi.fn(),
}));
vi.mock('@/hooks/use-merchant-client', () => ({
  useMerchant: () => ({ merchant: mocks.identity, basePath: '' }),
}));
vi.mock('@/components/builder/config', () => ({ builderConfig: {} }));
vi.mock('@puckeditor/core', () => ({
  Render: () => {
    mocks.legacy();
    return <p>Legacy rendered</p>;
  },
}));
vi.mock('@/lib/api-client', () => ({ apiGet: mocks.get }));
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({
              data: { published_config: mocks.config },
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}));

beforeEach(() => {
  mocks.identity = { ...merchant, template_id: 'puck' };
  mocks.config = home;
  mocks.legacy.mockClear();
  mocks.get.mockReset().mockResolvedValue({
    products: catalog.products.map((product) => ({
      ...product,
      status: 'active',
    })),
  });
});
describe('public Puck portable eligibility dispatch', () => {
  it('passes the actual Puck identity through to the portable adapter', async () => {
    render(<PuckStorefront />);
    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Our cameras' })
      ).toBeInTheDocument()
    );
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it.each([
    undefined,
    'ogabassey',
    'custom',
  ])('refuses actual template %j without inventing Puck eligibility', async (template_id) => {
    mocks.identity = { ...merchant, template_id };
    render(<PuckStorefront />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.legacy).not.toHaveBeenCalled();
  });
  it.each([
    0,
    false,
    '',
    null,
    undefined,
  ])('refuses explicitly present renderer version %j', async (rendererVersion) => {
    mocks.config = {
      ...home,
      root: { props: { ...home.root.props, rendererVersion } },
    };
    render(<PuckStorefront />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(mocks.legacy).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });
  it('keeps an absent renderer version on the legacy renderer', async () => {
    mocks.config = { ...home, root: { props: { title: 'Legacy' } } };
    render(<PuckStorefront />);
    await waitFor(() =>
      expect(screen.getByText('Legacy rendered')).toBeInTheDocument()
    );
  });
});

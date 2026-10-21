import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createPortablePublishedSnapshot } from '@/lib/portable-published-snapshot';
import {
  catalog,
  home,
  merchant,
} from '../../../../tools/builder-preview-spike/fixtures';
import {
  loadPortablePublicCatalog,
  PublicPortableHome,
} from './public-portable-home';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/lib/api-client', () => ({ apiGet: mocks.get }));
describe('public portable adapter', () => {
  it('uses the published API display projection and the shared renderer', async () => {
    mocks.get.mockResolvedValue({
      products: [
        {
          ...catalog.products[0],
          status: 'active',
          description: 'not included',
          cost_price: 1,
        },
        {
          ...catalog.products[0],
          id: '30000000-0000-4000-8000-000000000002',
          status: 'draft',
        },
      ],
    });
    const snapshot = await loadPortablePublicCatalog(merchant.id);
    expect(snapshot.products).toHaveLength(1);
    expect(snapshot.products[0]).not.toHaveProperty('cost_price');
    expect(mocks.get.mock.calls[0][0]).toContain('sort=newest');
    const { container } = render(
      <PublicPortableHome
        config={home}
        merchant={merchant}
        basePath="/task-zero-fixture"
      />
    );
    await waitFor(() =>
      expect(screen.getByText('Authorized fixture camera')).toBeInTheDocument()
    );
    const published = await createPortablePublishedSnapshot(home);
    expect(container.querySelector('[data-published-version]')).toHaveAttribute(
      'data-published-version',
      published.publishedVersion
    );
    expect(screen.getByRole('link', { name: 'Explore' })).toHaveAttribute(
      'href',
      '/task-zero-fixture/products'
    );
  });
  it('does not substitute samples when the public catalog fails', async () => {
    mocks.get.mockRejectedValue(new Error('unavailable'));
    render(
      <PublicPortableHome config={home} merchant={merchant} basePath="" />
    );
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        'Homepage unavailable'
      )
    );
  });
});

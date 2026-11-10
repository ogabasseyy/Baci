import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const load = vi.hoisted(() => vi.fn());
const location = vi.hoisted(() => ({ path: '/qa1' }));
vi.mock('@/lib/experience/published-manifest', () => ({
  loadPublishedExperience: load,
}));
vi.mock('@/components/storefront/experience/ExperienceShell', () => ({
  ExperienceShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('./storefront-layout-renderer', () => ({
  StorefrontLayoutRenderer: ({ children }: { children: React.ReactNode }) => (
    <div>
      <p>Native store</p>
      {children}
    </div>
  ),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => location.path,
}));

import { ResolvedExperienceStorefrontLayout } from './experience-storefront-layout';

it('shows an actionable error instead of blank content or stale native prices when the current head cannot be read', async () => {
  load.mockRejectedValueOnce(Error('PUBLIC_UNAVAILABLE'));
  render(
    await ResolvedExperienceStorefrontLayout({
      merchant: { id: 'm' } as never,
      children: <p>private</p>,
      preloadHeroLcpImages: false,
      routingMode: 'path',
    })
  );
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Storefront temporarily unavailable'
  );
  expect(
    screen.getByRole('button', { name: 'Refresh storefront' })
  ).toBeVisible();
  expect(screen.queryByText('Native store')).toBeNull();
});
it('preserves the existing native layout when no experience is enabled', async () => {
  load.mockResolvedValueOnce(null);
  render(
    await ResolvedExperienceStorefrontLayout({
      merchant: { id: 'm' } as never,
      children: null,
      preloadHeroLcpImages: false,
      routingMode: 'path',
    })
  );
  expect(screen.getByText('Native store')).toBeVisible();
});

it.each([
  '/qa1/checkout',
  '/checkout',
])('preserves native checkout when its parent published head throws: %s', async (path) => {
  location.path = path;
  try {
    load.mockRejectedValueOnce(Error('MERCHANT_MISMATCH'));
    render(
      await ResolvedExperienceStorefrontLayout({
        merchant: { id: 'm', slug: 'qa1' } as never,
        children: <p>Checkout form</p>,
        preloadHeroLcpImages: false,
        routingMode: path.startsWith('/qa1') ? 'path' : 'domain',
      })
    );
    expect(screen.getByText('Checkout form')).toBeVisible();
    expect(screen.queryByRole('alert')).toBeNull();
  } finally {
    location.path = '/qa1';
  }
});

it.each([
  '/qa1/phones/device',
  '/qa1/saved-items',
  '/qa1/checkout',
])('retains native chrome/providers outside a home-only experience: %s', async (path) => {
  location.path = path;
  try {
    load.mockResolvedValueOnce({ routes: [{ path: '/', view: 'home' }] });
    render(
      await ResolvedExperienceStorefrontLayout({
        merchant: { id: 'm', slug: 'qa1' } as never,
        children: <p>Native route</p>,
        preloadHeroLcpImages: false,
        routingMode: 'path',
      })
    );
    expect(screen.getByText('Native store')).toBeVisible();
    expect(screen.getByText('Native route')).toBeVisible();
  } finally {
    location.path = '/qa1';
  }
});

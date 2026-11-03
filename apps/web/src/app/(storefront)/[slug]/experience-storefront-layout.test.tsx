import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const load = vi.hoisted(() => vi.fn());
vi.mock('@/lib/experience/published-manifest', () => ({
  loadPublishedExperience: load,
}));
vi.mock('@/components/storefront/experience/ExperienceShell', () => ({
  ExperienceShell: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));
vi.mock('./storefront-layout-renderer', () => ({
  StorefrontLayoutRenderer: () => <p>Native store</p>,
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

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

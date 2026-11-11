import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const location = vi.hoisted(() => ({ path: '/qa1' }));
vi.mock('next/navigation', () => ({ usePathname: () => location.path }));

import { ExperienceLayoutSwitch } from './experience-layout-switch';

it('uses custom layout only on owned routes and restores native providers on navigation', () => {
  const props = {
    routes: [{ path: '/', view: 'home' as const }],
    basePath: '/qa1',
    nativeLayout: <p>Native providers and chrome</p>,
    children: <p>Custom page</p>,
  };
  const { rerender } = render(<ExperienceLayoutSwitch {...props} />);
  expect(screen.getByText('Custom page')).toBeVisible();
  expect(screen.queryByText('Native providers and chrome')).toBeNull();
  location.path = '/qa1/saved-items';
  rerender(<ExperienceLayoutSwitch {...props} />);
  expect(screen.getByText('Native providers and chrome')).toBeVisible();
  expect(screen.queryByText('Custom page')).toBeNull();
  location.path = '/qa1';
});

it('keeps the native cart continuation layout even when the experience owns product routes', () => {
  location.path = '/qa1/cart/experience';
  render(
    <ExperienceLayoutSwitch
      routes={[{ path: '/products/[handle]', view: 'product' }]}
      basePath="/qa1"
      nativeLayout={<p>Native cart providers</p>}
    >
      <p>Custom product</p>
    </ExperienceLayoutSwitch>
  );
  expect(screen.getByText('Native cart providers')).toBeVisible();
  expect(screen.queryByText('Custom product')).toBeNull();
  location.path = '/qa1';
});

it.each([
  '/repair/status',
  '/repairs/iphone-15',
])('retains native providers for %s when product routes are authored', (path) => {
  location.path = `/qa1${path}`;
  render(
    <ExperienceLayoutSwitch
      routes={[{ path: '/products/[handle]', view: 'product' }]}
      basePath="/qa1"
      nativeLayout={<p>Native repair providers</p>}
    >
      <p>Custom product</p>
    </ExperienceLayoutSwitch>
  );
  expect(screen.getByText('Native repair providers')).toBeVisible();
  expect(screen.queryByText('Custom product')).toBeNull();
  location.path = '/qa1';
});

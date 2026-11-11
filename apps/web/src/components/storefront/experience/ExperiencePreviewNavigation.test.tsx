import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ExperiencePreviewNavigation } from './ExperiencePreviewNavigation';
import type { ExperienceFrameLaunch } from './experience-frame-types';

it('renders preview routes and joins canonical paths with demo substitutions', () => {
  const onNavigate = vi.fn();
  const routes: ExperienceFrameLaunch['routes'] = [
    { path: '/', view: 'home' },
    { path: '/collections/[slug]', view: 'collection' },
    { path: '/products/[slug]/[variant]', view: 'product' },
    { path: '/pages/[slug]', view: 'editorial' },
  ];
  render(
    <ExperiencePreviewNavigation
      canonicalBase="https://preview.example/"
      routes={routes}
      onNavigate={onNavigate}
    />
  );

  const nav = screen.getByRole('navigation', { name: 'Preview routes' });
  expect(nav.querySelectorAll('button')).toHaveLength(4);
  for (const view of ['home', 'collection', 'product', 'editorial'])
    expect(screen.getByRole('button', { name: view })).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: 'collection' }));
  fireEvent.click(screen.getByRole('button', { name: 'product' }));
  fireEvent.click(screen.getByRole('button', { name: 'editorial' }));

  expect(onNavigate.mock.calls).toEqual([
    ['https://preview.example/collections/devices'],
    ['https://preview.example/products/device/device'],
    ['https://preview.example/pages/design'],
  ]);
});

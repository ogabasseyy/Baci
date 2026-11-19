import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null }, error: null }) },
  }),
}));

import { PrivatePreviewContent as Page } from './preview-content';

it('signed-out preview has an exact local sign-in return and does not create a launch', async () => {
  render(
    await Page({
      searchParams: Promise.resolve({
        merchant: 'bad',
        build: 'bad',
        redirect: 'https://evil.invalid',
      }),
    })
  );
  expect(
    screen.getByRole('link', { name: 'Sign in to Baci' }).getAttribute('href')
  ).toBe('/login?redirect=%2Fbuilder%2Fexperience%2Fpreview');
});

it('preserves the selected route through the exact sign-in return', async () => {
  const merchant = '11111111-1111-4111-8111-111111111111';
  const build = '22222222-2222-4222-8222-222222222222';
  render(
    await Page({
      searchParams: Promise.resolve({
        merchant,
        build,
        routeId: '/collections/all',
      }),
    })
  );
  const link = screen.getByRole('link', { name: 'Sign in to Baci' });
  const redirect = new URL(
    link.getAttribute('href') ?? '',
    'http://localhost'
  ).searchParams.get('redirect');
  expect(
    new URL(redirect ?? '', 'http://localhost').searchParams.get('routeId')
  ).toBe('/collections/all');
});

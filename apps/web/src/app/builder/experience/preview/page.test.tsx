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

import { expect, it, vi } from 'vitest';

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }),
    },
  }),
}));

import { PreviewClient } from './preview-client';
import { PrivatePreviewContent } from './preview-content';

it('passes the requested route into the interactive owner preview', async () => {
  const page = await PrivatePreviewContent({
    searchParams: Promise.resolve({
      merchant: '11111111-1111-4111-8111-111111111111',
      build: '22222222-2222-4222-8222-222222222222',
      routeId: '/collections/all',
    }),
  });
  expect(page.type).toBe(PreviewClient);
  expect(page.props.routeId).toBe('/collections/all');
});

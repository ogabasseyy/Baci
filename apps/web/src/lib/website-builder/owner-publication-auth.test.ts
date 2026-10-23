import { expect, it, vi } from 'vitest';
import {
  checkPublicationMutation,
  publicationOwnerClient,
} from './owner-publication-auth';

const mocks = vi.hoisted(() => ({ getUser: vi.fn(), csrf: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: mocks.getUser } }),
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: mocks.csrf }));
it('requires a verified normal browser user', async () => {
  mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
  expect(await publicationOwnerClient()).toBeNull();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'owner' } },
    error: new Error('expired'),
  });
  expect(await publicationOwnerClient()).toBeNull();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: 'owner' } },
    error: null,
  });
  expect(await publicationOwnerClient()).toEqual({
    auth: { getUser: mocks.getUser },
  });
});
it('preserves CSRF rejection response and fails closed without one', async () => {
  const req = new Request('https://usebaci.com/api', { method: 'POST' });
  const denied = new Response('denied', { status: 403 });
  mocks.csrf.mockResolvedValue({ valid: false, response: denied });
  expect(await checkPublicationMutation(req)).toBe(denied);
  mocks.csrf.mockResolvedValue({ valid: false });
  expect((await checkPublicationMutation(req))?.status).toBe(403);
  mocks.csrf.mockResolvedValue({ valid: true });
  expect(await checkPublicationMutation(req)).toBeNull();
});

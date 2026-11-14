import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
const deps = vi.hoisted(() => ({
  auth: vi.fn(),
  csrf: vi.fn(),
  configured: vi.fn(),
}));
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: deps.auth } }),
}));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: deps.csrf }));
vi.mock('@/lib/experience/owner-approval-web-config', () => ({
  getConfiguredOwnerApproval: deps.configured,
}));

import { installExperienceOwnerRuntime } from '@/lib/experience/owner-runtime';
import { GET, POST } from './route';

const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => vi.clearAllMocks());
it('authenticates before revealing runtime state; missing runtime returns 503', async () => {
  deps.auth.mockResolvedValueOnce({ data: { user: null }, error: null });
  expect((await GET(new NextRequest('http://localhost/api'))).status).toBe(401);
  deps.auth.mockResolvedValue({ data: { user: { id } }, error: null });
  expect(
    (await GET(new NextRequest(`http://localhost/api?approval=${id}`))).status
  ).toBe(503);
});
it('installed HTTP GET is read-only; POST requires CSRF and confirms only the parsed ID', async () => {
  deps.auth.mockResolvedValue({ data: { user: { id } }, error: null });
  deps.csrf.mockResolvedValue({ valid: true });
  const load = vi.fn(async () => ({ status: 'confirmation-required' }));
  const confirm = vi.fn(async () => ({ version: 1 }));
  const remove = installExperienceOwnerRuntime({
    createPreviewLaunch: async () => null,
    approval: { load, confirm },
  });
  try {
    expect(
      (await GET(new NextRequest(`http://localhost/api?approval=${id}`))).status
    ).toBe(200);
    expect(confirm).not.toHaveBeenCalled();
    deps.csrf.mockResolvedValueOnce({ valid: false });
    const post = () =>
      POST(
        new NextRequest('http://localhost/api', {
          method: 'POST',
          body: JSON.stringify({ action: 'confirm-draft', approvalId: id }),
        })
      );
    expect((await post()).status).toBe(403);
    expect(confirm).not.toHaveBeenCalled();
    expect((await post()).status).toBe(200);
    expect(confirm).toHaveBeenCalledWith(expect.anything(), id);
  } finally {
    remove();
  }
});
it('uses the configured draft verifier only after authentication and CSRF', async () => {
  deps.auth.mockResolvedValue({ data: { user: { id } }, error: null });
  deps.csrf.mockResolvedValue({ valid: false });
  const confirm = vi.fn(async () => ({ version: 1 }));
  deps.configured.mockReturnValue({ load: vi.fn(), confirm });
  try {
    const post = () =>
      POST(
        new NextRequest('http://localhost/api', {
          method: 'POST',
          body: JSON.stringify({ action: 'confirm-draft', approvalId: id }),
        })
      );
    expect((await post()).status).toBe(403);
    expect(confirm).not.toHaveBeenCalled();
    deps.csrf.mockResolvedValue({ valid: true });
    expect((await post()).status).toBe(200);
    expect(confirm).toHaveBeenCalledOnce();
  } finally {
    deps.configured.mockReset();
  }
});

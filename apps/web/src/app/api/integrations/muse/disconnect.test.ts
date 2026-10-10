import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';

const { csrf, owner } = vi.hoisted(() => ({ csrf: vi.fn(), owner: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ checkCsrfProtection: csrf }));
vi.mock('./connection-helpers', async (original) => ({
  ...(await original<typeof import('./connection-helpers')>()),
  resolveOwnerContext: owner,
  authenticateConnectorRequest: vi
    .fn()
    .mockResolvedValue({ ok: true, auth: {} }),
}));

import { disconnectConnector } from './disconnect';

beforeEach(() => {
  vi.clearAllMocks();
  csrf.mockResolvedValue({ valid: true });
});
it('rejects failed CSRF protection before resolving a merchant', async () => {
  csrf.mockResolvedValue({
    valid: false,
    response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
  });
  expect(
    (
      await disconnectConnector(
        new NextRequest('https://usebaci.com/api/integrations/muse', {
          method: 'DELETE',
        })
      )
    ).status
  ).toBe(403);
  expect(owner).not.toHaveBeenCalled();
});
it('returns a client error for malformed JSON without revoking anything', async () => {
  expect(
    (
      await disconnectConnector(
        new NextRequest('https://usebaci.com/api/integrations/muse', {
          method: 'DELETE',
          body: '{',
        })
      )
    ).status
  ).toBe(400);
  expect(owner).not.toHaveBeenCalled();
});

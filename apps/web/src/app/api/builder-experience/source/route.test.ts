import { NextRequest } from 'next/server';
import { expect, it, vi } from 'vitest';

vi.mock('@/lib/csrf', () => ({
  checkCsrfProtection: vi.fn(async () => ({ valid: true })),
}));
vi.mock('@/lib/experience/owner-request', () => ({
  authenticateExperienceOwnerRequest: vi.fn(async () => async () => ({
    merchantId: '11111111-1111-4111-8111-111111111111',
  })),
  resolveExperienceOwnerRequest: vi.fn(async () => ({
    merchantId: '11111111-1111-4111-8111-111111111111',
  })),
}));
vi.mock('@/lib/experience/source-service', () => ({
  patchSource: vi.fn(async () => ({ status: 'applied' })),
  readSource: vi.fn(),
}));

import { checkCsrfProtection } from '@/lib/csrf';
import { authenticateExperienceOwnerRequest } from '@/lib/experience/owner-request';
import { patchSource } from '@/lib/experience/source-service';
import { POST } from './route';

const id = '11111111-1111-4111-8111-111111111111';
const body = {
  storefrontId: id,
  operation: 'patch',
  baseDigest: 'a'.repeat(64),
  expectedVersion: 1,
  files: [{ path: 'app.tsx', content: 'x'.repeat(81920) }],
  idempotencyKey: id,
};
it('accepts a complete valid file over64KiB while retaining bounded request and normal owner patch', async () => {
  const r = await POST(
    new NextRequest('http://127.0.0.1/api/source', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  );
  expect(r.status).toBe(200);
  expect(patchSource).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ files: body.files })
  );
});
it('rejects over-budget bodies and failed CSRF before patch', async () => {
  vi.mocked(patchSource).mockClear();
  const r = await POST(
    new NextRequest('http://127.0.0.1/api/source', {
      method: 'POST',
      body: 'x'.repeat(4194305),
    })
  );
  expect(r.status).toBe(400);
  expect(patchSource).not.toHaveBeenCalled();
  vi.mocked(checkCsrfProtection).mockResolvedValueOnce({
    valid: false,
  } as never);
  expect(
    (
      await POST(
        new NextRequest('http://127.0.0.1/api/source', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      )
    ).status
  ).toBe(403);
  expect(patchSource).not.toHaveBeenCalled();
});

it('rejects an anonymous request without reading the source body', async () => {
  vi.mocked(authenticateExperienceOwnerRequest).mockRejectedValueOnce(
    Error('NOT_FOUND')
  );
  const request = new NextRequest('http://127.0.0.1/api/source', {
    method: 'POST',
    body: '{',
  });
  expect((await POST(request)).status).toBe(403);
  expect(request.bodyUsed).toBe(false);
});

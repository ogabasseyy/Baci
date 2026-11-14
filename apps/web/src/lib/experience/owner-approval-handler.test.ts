import { expect, it, vi } from 'vitest';
import { createOwnerApprovalHandler } from './owner-approval-handler';

const id = '11111111-1111-4111-8111-111111111111';
function fixture() {
  const load = vi.fn(async () => ({ status: 'confirmation-required' }));
  const confirm = vi.fn(async () => ({ version: 1 }));
  const checkMutation = vi.fn(async (): Promise<Response | null> => null);
  const ownerClient = vi.fn(async () => ({}) as never);
  return {
    load,
    confirm,
    checkMutation,
    ownerClient,
    handler: createOwnerApprovalHandler({
      load,
      confirm,
      checkMutation,
      ownerClient,
    }),
  };
}
it('GET reads only and never confirms an intent', async () => {
  const f = fixture();
  expect(
    (await f.handler(new Request(`http://localhost/api?approval=${id}`))).status
  ).toBe(200);
  expect(f.load).toHaveBeenCalledOnce();
  expect(f.confirm).not.toHaveBeenCalled();
  expect(f.checkMutation).not.toHaveBeenCalled();
});
it('POST uses owner auth and CSRF before confirming the exact intent', async () => {
  const f = fixture();
  const r = await f.handler(
    new Request('http://localhost/api', {
      method: 'POST',
      body: JSON.stringify({ action: 'confirm-draft', approvalId: id }),
    })
  );
  expect(r.status).toBe(200);
  expect(r.headers.get('Cache-Control')).toBe('private, no-store');
  expect(f.confirm).toHaveBeenCalledWith(expect.anything(), id);
});
it('fails closed for missing owner, rejected CSRF, malformed JSON and approval booleans', async () => {
  const f = fixture();
  f.ownerClient.mockResolvedValueOnce(null as never);
  expect((await f.handler(new Request('http://localhost/api'))).status).toBe(
    401
  );
  f.checkMutation.mockResolvedValueOnce(new Response(null, { status: 403 }));
  expect(
    (
      await f.handler(
        new Request('http://localhost/api', { method: 'POST', body: '{}' })
      )
    ).status
  ).toBe(403);
  for (const body of [
    '{',
    JSON.stringify({ action: 'confirm-draft', approvalId: id, approved: true }),
  ])
    expect(
      (
        await f.handler(
          new Request('http://localhost/api', { method: 'POST', body })
        )
      ).status
    ).toBe(400);
  expect(f.confirm).not.toHaveBeenCalled();
});
it('returns a safe bounded error when confirmation fails; never retries a mutation', async () => {
  const f = fixture();
  f.confirm.mockRejectedValueOnce(Error('private details'));
  const r = await f.handler(
    new Request('http://localhost/api', {
      method: 'POST',
      body: JSON.stringify({ action: 'confirm-draft', approvalId: id }),
    })
  );
  expect(r.status).toBe(403);
  expect(await r.text()).not.toContain('private details');
  expect(f.confirm).toHaveBeenCalledOnce();
});

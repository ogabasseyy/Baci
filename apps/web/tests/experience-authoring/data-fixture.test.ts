import { expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { localApiResponse } from './data-fixture.test-support';

it('normal DataAPI void RPC responses retain a null body for204 rather than hanging the client', async () => {
  const r = localApiResponse(204, Buffer.alloc(0), {});
  expect(r.status).toBe(204);
  expect(r.body).toBeNull();
  expect(await r.text()).toBe('');
  expect(
    await localApiResponse(200, Buffer.from('{"ok":true}'), {
      'content-type': 'application/json',
    }).json()
  ).toEqual({ ok: true });
});

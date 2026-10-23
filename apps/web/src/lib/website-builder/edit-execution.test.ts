import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import { createEditExecutionHandler } from './edit-execution';

const id = '10000000-0000-4000-8000-000000000001';
describe('fixed execution endpoint', () => {
  const url = `https://usebaci.com/api/integrations/chatgpt/builder-operations/${id}/run`;
  it('denies absent bearer before authentication; cookies grant no authority', async () => {
    const authenticate = vi.fn();
    const handler = createEditExecutionHandler({
      authenticate,
      execute: vi.fn(),
    });
    expect(
      (
        await handler(
          new Request(url, {
            method: 'POST',
            headers: { cookie: 'session=x' },
          }),
          id
        )
      ).status
    ).toBe(401);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it('rejects arbitrary JSON and invalid upstream auth without cookie fallback', async () => {
    const authenticate = vi.fn().mockRejectedValue(new Error('sensitive'));
    const handler = createEditExecutionHandler({
      authenticate,
      execute: vi.fn(),
    });
    expect(
      (
        await handler(
          new Request(url, {
            method: 'POST',
            headers: { authorization: 'Bearer invalid' },
            body: '{}',
          }),
          id
        )
      ).status
    ).toBe(400);
    const r = await handler(
      new Request(url, {
        method: 'POST',
        headers: { authorization: 'Bearer invalid' },
      }),
      id
    );
    expect(r.status).toBe(401);
    expect(await r.text()).not.toContain('sensitive');
  });
  it('resolves bindings from the stored operation; returns no config/token', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { connectionId: id, grantVersion: 1, merchantId: id },
      error: null,
    });
    const authenticate = vi.fn().mockResolvedValue({
      actorUserId: id,
      client: { rpc } as unknown as SupabaseClient,
    });
    const execute = vi.fn().mockResolvedValue({ status: 'ready' });
    const handler = createEditExecutionHandler({ authenticate, execute });
    const r = await handler(
      new Request(url, {
        method: 'POST',
        headers: { authorization: 'Bearer upstream' },
      }),
      id
    );
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: 'accepted' });
    expect(rpc).toHaveBeenCalledWith('builder_operation_context', {
      p_operation: id,
    });
    expect(execute).toHaveBeenCalledOnce();
  });
});

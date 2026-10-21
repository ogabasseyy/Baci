import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createOAuthRecordStore } from './guest-oauth-postgres';
it('encrypts values with tenant and record-key binding and decrypts after restart', async () => {
  let saved: Record<string, unknown> = {};
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    if (name.endsWith('_purge_expired')) return { data: 0, error: null };
    if (name.endsWith('_cas')) {
      saved = args;
      return { data: true, error: null };
    }
    return {
      data: [
        {
          ciphertext: saved.p_ciphertext,
          revision: 1,
          expires_at: saved.p_expires_at,
        },
      ],
      error: null,
    };
  });
  const args = {
    client: { rpc } as unknown as SupabaseClient,
    merchantId: '11111111-1111-4111-8111-111111111111',
    encryptionKey: Buffer.alloc(32, 7),
  };
  const store = createOAuthRecordStore(args);
  await store.compareAndSwap(
    'grant:test',
    0,
    { cartToken: 'secret-cart-capability' },
    Date.now() + 1000,
  );
  expect(JSON.stringify(saved)).not.toContain('secret-cart-capability');
  expect((await createOAuthRecordStore(args).read('grant:test'))?.value).toEqual({
    cartToken: 'secret-cart-capability',
  });
  await expect(
    createOAuthRecordStore({
      ...args,
      merchantId: '22222222-2222-4222-8222-222222222222',
    }).read('grant:test'),
  ).rejects.toThrow();
  await expect(store.read('grant:other')).rejects.toThrow();
});
it('fails closed on query failure and rejects weak encryption keys', async () => {
  const args = {
    client: {
      rpc: vi.fn().mockResolvedValue({ error: { message: 'private' }, data: null }),
    } as unknown as SupabaseClient,
    merchantId: '11111111-1111-4111-8111-111111111111',
    encryptionKey: Buffer.alloc(32, 7),
  };
  await expect(createOAuthRecordStore(args).read('grant:x')).rejects.toThrow(
    'OAuth storage unavailable',
  );
  expect(() => createOAuthRecordStore({ ...args, encryptionKey: Buffer.alloc(16) })).toThrow();
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createServiceClient } = vi.hoisted(() => ({
  createServiceClient: vi.fn(() => ({
    rpc: vi.fn(),
  })),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient,
}));

import { createReceiptLoginHintServiceClient } from './server-login-hint-client';

describe('createReceiptLoginHintServiceClient', () => {
  it('uses the dedicated branded server-only factory sentinel', () => {
    expect(createReceiptLoginHintServiceClient()).toEqual({
      rpc: expect.any(Function),
    });
    expect(createServiceClient).toHaveBeenCalledWith('receipt-login-hint');
  });

  it('exposes only the RPC surface at runtime', () => {
    expect(Object.keys(createReceiptLoginHintServiceClient())).toEqual(['rpc']);
  });

  it('refuses any RPC other than the login-hint one', () => {
    const handle = createReceiptLoginHintServiceClient();
    expect(() =>
      (handle.rpc as (...args: unknown[]) => unknown)('other_function', {})
    ).toThrow('receipt-login-hint handle refuses RPC');
  });

  it('declares the server-only marker before any runtime imports', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/receipts/server-login-hint-client.ts'),
      'utf8'
    );

    expect(source).toMatch(/^import ['"]server-only['"];?/);
    expect(source).not.toMatch(/NEXT_PUBLIC_/);
  });
});

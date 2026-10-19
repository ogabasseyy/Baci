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

import { createLoyaltyResolverServiceClient } from './server-resolver-client';

describe('createLoyaltyResolverServiceClient', () => {
  it('uses the dedicated branded server-only factory sentinel', () => {
    expect(createLoyaltyResolverServiceClient()).toEqual({
      rpc: expect.any(Function),
    });
    expect(createServiceClient).toHaveBeenCalledWith('loyalty-resolver');
  });

  it('declares the server-only marker before any runtime imports', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/loyalty/server-resolver-client.ts'),
      'utf8'
    );

    expect(source).toMatch(/^import ['"]server-only['"];?/);
    expect(source).not.toMatch(/NEXT_PUBLIC_/);
  });
});

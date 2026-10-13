import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { createServiceClient } = vi.hoisted(() => ({
  createServiceClient: vi.fn(() => ({ rpc: vi.fn() })),
}));

vi.mock('@/lib/supabase/service', () => ({
  createServiceClient,
}));

import { createJumiaCredentialServiceClient } from './server-credential-client';

describe('createJumiaCredentialServiceClient', () => {
  it('uses the dedicated branded server-only factory sentinel', () => {
    expect(createJumiaCredentialServiceClient()).toEqual({
      rpc: expect.any(Function),
    });
    expect(createServiceClient).toHaveBeenCalledWith('jumia-credentials');
  });

  it('declares the server-only marker before any runtime imports', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/lib/jumia/server-credential-client.ts'),
      'utf8'
    );

    expect(source).toMatch(/^import ['"]server-only['"];?/);
    expect(source).not.toMatch(/NEXT_PUBLIC_/);
  });
});

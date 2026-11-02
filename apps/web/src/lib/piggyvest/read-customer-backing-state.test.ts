import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The helper must only use the client it is given. These spies catch any
// privileged factory it might reach for instead.
const privilegedFactories = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createAdminFactoryClient: vi.fn(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: privilegedFactories.createAdminClient,
  createClient: privilegedFactories.createAdminFactoryClient,
}));

import { readCustomerBackingState } from './read-customer-backing-state';

const MERCHANT_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b';

type RpcResult = { data: unknown; error: unknown };

function clientReturning(result: RpcResult | Error) {
  const rpc = vi.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

describe('readCustomerBackingState', () => {
  beforeEach(() => {
    privilegedFactories.createAdminClient.mockReset();
    privilegedFactories.createAdminFactoryClient.mockReset();
  });

  it.each([
    'none',
    'legacy',
    'migrating',
    'backed',
  ] as const)('returns %s from the caller-scoped RPC on the given client', async (state) => {
    // Arrange
    const { client, rpc } = clientReturning({ data: state, error: null });

    // Act
    const result = await readCustomerBackingState(client, MERCHANT_ID);

    // Assert
    expect(result).toBe(state);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('get_my_wallet_backing_state', {
      p_merchant_id: MERCHANT_ID,
    });
    expect(privilegedFactories.createAdminClient).not.toHaveBeenCalled();
    expect(privilegedFactories.createAdminFactoryClient).not.toHaveBeenCalled();
  });

  it('fails closed to unknown when the RPC returns an error', async () => {
    // Arrange
    const { client } = clientReturning({
      data: null,
      error: { code: 'PGRST202', message: 'function not found' },
    });

    // Act & Assert
    await expect(readCustomerBackingState(client, MERCHANT_ID)).resolves.toBe(
      'unknown'
    );
    expect(privilegedFactories.createAdminClient).not.toHaveBeenCalled();
  });

  it('fails closed to unknown when the RPC throws', async () => {
    // Arrange
    const { client } = clientReturning(new Error('network down'));

    // Act & Assert
    await expect(readCustomerBackingState(client, MERCHANT_ID)).resolves.toBe(
      'unknown'
    );
    expect(privilegedFactories.createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    null,
    'BACKED',
    'unknown',
    { state: 'backed' },
    ['backed'],
  ])('fails closed to unknown on an unexpected reply %j', async (data) => {
    // Arrange
    const { client } = clientReturning({ data, error: null });

    // Act & Assert
    await expect(readCustomerBackingState(client, MERCHANT_ID)).resolves.toBe(
      'unknown'
    );
  });

  it('returns unknown without calling the RPC for a malformed merchant id', async () => {
    // Arrange
    const { client, rpc } = clientReturning({ data: 'backed', error: null });

    // Act
    const result = await readCustomerBackingState(client, 'not-a-uuid');

    // Assert
    expect(result).toBe('unknown');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('never imports a privileged Supabase client factory', () => {
    // Arrange
    const source = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        'read-customer-backing-state.ts'
      ),
      'utf8'
    );

    // Act & Assert: only the route's own client may be used.
    expect(source).not.toMatch(/@\/lib\/supabase\/(admin|service)/);
    expect(source).not.toMatch(/createAdminClient|createServiceClient/);
  });
});

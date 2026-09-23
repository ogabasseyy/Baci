import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createScopedClient: vi.fn(),
  signScopedSupabaseJwt: vi.fn(),
}));

vi.mock('@/lib/supabase/scoped', () => ({
  createScopedClient: mocks.createScopedClient,
}));
vi.mock('@/lib/supabase/scoped-jwt', () => ({
  signScopedSupabaseJwt: mocks.signScopedSupabaseJwt,
}));

import { createRepairPickupReceiverClient } from './repair-pickup-receiver-client';

describe('createRepairPickupReceiverClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.signScopedSupabaseJwt.mockReturnValue('signed-receiver-token');
    mocks.createScopedClient.mockReturnValue({ rpc: vi.fn() });
  });

  it('binds a short-lived server capability to one merchant', () => {
    const client = createRepairPickupReceiverClient(
      '123e4567-e89b-12d3-a456-426614174000',
      new Date('2026-09-03T10:00:00.000Z')
    );

    expect(mocks.signScopedSupabaseJwt).toHaveBeenCalledWith(
      expect.objectContaining({
        aud: 'authenticated',
        exp: 1_788_429_660,
        iat: 1_788_429_600,
        repair_pickup_receiver_context: 'server-quote',
        repair_pickup_receiver_merchant_id:
          '123e4567-e89b-12d3-a456-426614174000',
        role: 'repair_pickup_receiver',
      })
    );
    expect(mocks.createScopedClient).toHaveBeenCalledWith(
      'signed-receiver-token'
    );
    expect(client).toBe(mocks.createScopedClient.mock.results[0]?.value);
  });

  it('binds paid fulfillment to the dedicated receiver context', () => {
    createRepairPickupReceiverClient(
      '123e4567-e89b-12d3-a456-426614174000',
      new Date('2026-09-03T10:00:00.000Z'),
      'server-fulfillment'
    );

    expect(mocks.signScopedSupabaseJwt).toHaveBeenCalledWith(
      expect.objectContaining({
        repair_pickup_receiver_context: 'server-fulfillment',
        repair_pickup_receiver_merchant_id:
          '123e4567-e89b-12d3-a456-426614174000',
        role: 'repair_pickup_receiver',
      })
    );
  });
});

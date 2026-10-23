import type { SupabaseClient } from '@supabase/supabase-js';
import { vi } from 'vitest';
import type { BuilderContext } from '@/lib/builder-connector/types';

export const id = '10000000-0000-4000-8000-000000000001';
export function setup(data: unknown) {
  const rpc = vi.fn().mockImplementation(async (name: string) => ({
    data: name === 'builder_prepare_apply' ? null : data,
    error: null,
  }));
  const ctx: BuilderContext = {
    identity: {
      actorUserId: id,
      connectionId: id,
      grantVersion: 1,
      scopes: new Set(['storefront.read', 'storefront.write']),
      allowedMerchantIds: [id],
      allowCreateStore: false,
    },
    merchantId: id,
    supabase: { rpc } as unknown as SupabaseClient<never>,
  };
  return { rpc, ctx };
}

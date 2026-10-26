import type { SupabaseClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { enqueueNativeLayout } from './enqueue-native-layout';

const merchant = '10000000-0000-4000-8000-000000000001';
const input = {
  pageSlug: 'home',
  businessName: 'Shop',
  businessType: 'electronics',
  brandColors: null,
  createdPageConfigUpdatedAt: null,
};
it('returns only the historical DTO, never a captured private starter', async () => {
  const rpc = vi.fn().mockResolvedValue({
    data: {
      id: merchant,
      merchant_id: merchant,
      type: 'storefront_layout_generation',
      status: 'pending',
      created_at: 'stamp',
      starterConfig: { private: 'sensitive' },
    },
    error: null,
  });
  const result = await enqueueNativeLayout(
    { rpc } as unknown as SupabaseClient,
    merchant,
    input
  );
  expect(result.error).toBeNull();
  expect(result.data?.input).toEqual(input);
  expect(JSON.stringify(result)).not.toContain('sensitive');
});
it('rejects missing and foreign receipts without returning provider details', async () => {
  for (const data of [
    null,
    {
      id: merchant,
      merchant_id: '20000000-0000-4000-8000-000000000001',
      type: 'storefront_layout_generation',
      status: 'pending',
      created_at: 'stamp',
    },
  ]) {
    const result = await enqueueNativeLayout(
      {
        rpc: vi.fn().mockResolvedValue({ data, error: null }),
      } as unknown as SupabaseClient,
      merchant,
      input
    );
    expect(result.data).toBeNull();
    expect(result.error?.code).toBe('INVALID_PRIVATE_JOB_RECEIPT');
  }
});

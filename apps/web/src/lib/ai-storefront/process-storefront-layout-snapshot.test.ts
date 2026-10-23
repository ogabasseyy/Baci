import { describe, expect, it, vi } from 'vitest';
import { processStorefrontLayoutSnapshot } from './process-storefront-layout-job';

vi.mock('@/lib/ai-storefront/ollama-storefront-client', () => ({
  generateStorefrontLayoutWithOllama: vi
    .fn()
    .mockResolvedValue({ sections: [], designRationale: 'fixture' }),
}));
describe('authorized native AI starter snapshot', () => {
  it('generates using captured job input without reading private or public drafts', async () => {
    const from = vi.fn((table: string) => {
      if (table !== 'products')
        throw new Error(`Unapproved worker read: ${table}`);
      const query = { eq: vi.fn(), count: 0, error: null };
      query.eq.mockReturnValue(query);
      return { select: vi.fn().mockReturnValue(query) };
    });
    const result = await processStorefrontLayoutSnapshot({
      supabase: { from } as never,
      merchantId: 'merchant-1',
      jobId: 'job-1',
      input: {
        businessName: 'Shop',
        businessType: 'general',
        brandColors: null,
        pageSlug: 'home',
        createdPageConfigUpdatedAt: '2026-10-20T12:00:00.000Z',
      },
      starterSnapshot: {
        config: { content: [], root: {}, zones: {} },
        updatedAt: '2026-10-20T12:00:00.000Z',
      },
    });
    expect(result.applied).toBe(false);
    expect(result.generatedAgainstUpdatedAt).toBe('2026-10-20T12:00:00.000Z');
    expect(from.mock.calls.map(([table]) => table)).toEqual(['products']);
  });
  it('rejects absent or invalid snapshots before any worker table read', async () => {
    const from = vi.fn();
    await expect(
      processStorefrontLayoutSnapshot({
        supabase: { from } as never,
        merchantId: 'merchant-1',
        jobId: 'job-1',
        input: {
          businessName: 'Shop',
          businessType: 'general',
          brandColors: null,
          pageSlug: 'home',
          createdPageConfigUpdatedAt: null,
        },
        starterSnapshot: { config: null, updatedAt: null },
      })
    ).rejects.toThrow('Starter page config failed validation');
    expect(from).not.toHaveBeenCalled();
  });
});

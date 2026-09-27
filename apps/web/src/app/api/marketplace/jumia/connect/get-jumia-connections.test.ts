import { describe, expect, it, vi } from 'vitest';
import { getJumiaConnections } from './get-jumia-connections';

function buildSupabase(result: { data: unknown; error: unknown }) {
  const eq = vi.fn();
  eq.mockReturnValueOnce({ eq });
  eq.mockReturnValueOnce({ eq });
  eq.mockResolvedValueOnce(result);
  return {
    from: vi.fn(() => ({ select: vi.fn(() => ({ eq })) })),
  } as never;
}

describe('getJumiaConnections', () => {
  it('returns marketplace identity for connected business clients', async () => {
    const response = await getJumiaConnections(
      buildSupabase({
        data: [{ id: 'integration-1', marketplace_key: 'jumia-ng-main' }],
        error: null,
      }),
      'merchant-1'
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connected: true,
      integrations: [{ marketplace_key: 'jumia-ng-main' }],
    });
  });

  it('returns 500 when the scoped integration query fails', async () => {
    const response = await getJumiaConnections(
      buildSupabase({ data: null, error: { message: 'Database error' } }),
      'merchant-1'
    );
    expect(response.status).toBe(500);
  });
});

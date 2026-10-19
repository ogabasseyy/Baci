import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscoveryBackfillPanel } from './discovery-backfill-panel';

const fetchWithCsrf = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf }));

const merchantId = '11111111-1111-4111-8111-111111111111';
const savedCursor = '22222222-2222-4222-8222-222222222222';

describe('dashboard embedding provider limits', () => {
  beforeEach(() => {
    fetchWithCsrf.mockReset();
    window.localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('pauses a persistent provider limit after five attempts and preserves the cursor', async () => {
    vi.useFakeTimers();
    fetchWithCsrf
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          scanned: 5,
          generated: 5,
          nextCursor: savedCursor,
          done: false,
        }),
      })
      .mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          code: 'EMBEDDING_PROVIDER_RATE_LIMITED',
          resetIn: 0,
        }),
      });
    render(<DiscoveryBackfillPanel merchantId={merchantId} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start indexing' }));
      await Promise.resolve();
    });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(fetchWithCsrf).toHaveBeenCalledTimes(6);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The embedding provider limit has not reset. Continue indexing later.'
    );
    expect(screen.getByRole('status')).toHaveTextContent('Indexing paused.');
    expect(
      JSON.parse(
        window.localStorage.getItem(`discovery-backfill:${merchantId}`) ?? '{}'
      )
    ).toMatchObject({ cursor: savedCursor, complete: false });
  });
});

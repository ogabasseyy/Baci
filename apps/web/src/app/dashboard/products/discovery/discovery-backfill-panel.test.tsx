import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DiscoveryBackfillPanel } from './discovery-backfill-panel';

const fetchWithCsrf = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api-client', () => ({ fetchWithCsrf }));

const merchantId = '11111111-1111-4111-8111-111111111111';
const page = (result: unknown) =>
  Promise.resolve({
    ok: true,
    json: async () => result,
  });

describe('dashboard catalog indexing', () => {
  beforeEach(() => fetchWithCsrf.mockReset());

  it('runs batches under the selected merchant session and reports completion', async () => {
    fetchWithCsrf
      .mockImplementationOnce(() =>
        page({
          scanned: 5,
          generated: 4,
          nextCursor: 'cursor-1',
          done: false,
        })
      )
      .mockImplementationOnce(() =>
        page({
          scanned: 2,
          generated: 1,
          nextCursor: 'cursor-2',
          done: true,
        })
      );
    render(<DiscoveryBackfillPanel merchantId={merchantId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start indexing' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Indexing complete. 7 scanned, 5 updated.'
      )
    );
    expect(fetchWithCsrf).toHaveBeenNthCalledWith(
      1,
      '/api/products/discovery-backfill',
      expect.objectContaining({
        body: JSON.stringify({ merchantId, cursor: null }),
      })
    );
    expect(fetchWithCsrf).toHaveBeenNthCalledWith(
      2,
      '/api/products/discovery-backfill',
      expect.objectContaining({
        body: JSON.stringify({ merchantId, cursor: 'cursor-1' }),
      })
    );
  });

  it('keeps the last completed cursor after a failure so retry is idempotent', async () => {
    fetchWithCsrf
      .mockImplementationOnce(() =>
        page({
          scanned: 5,
          generated: 5,
          nextCursor: 'cursor-1',
          done: false,
        })
      )
      .mockImplementationOnce(async () => ({
        ok: false,
        status: 502,
        json: async () => ({ error: 'Retry this batch.' }),
      }))
      .mockImplementationOnce(() =>
        page({
          scanned: 1,
          generated: 1,
          nextCursor: 'cursor-2',
          done: true,
        })
      );
    render(<DiscoveryBackfillPanel merchantId={merchantId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start indexing' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Retry this batch.')
    );
    fireEvent.click(screen.getByRole('button', { name: 'Continue indexing' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Indexing complete. 6 scanned, 6 updated.'
      )
    );
    expect(fetchWithCsrf).toHaveBeenNthCalledWith(
      3,
      '/api/products/discovery-backfill',
      expect.objectContaining({
        body: JSON.stringify({ merchantId, cursor: 'cursor-1' }),
      })
    );
  });

  it('shows a generic error when a gateway returns a non-JSON failure', async () => {
    fetchWithCsrf.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    });
    render(<DiscoveryBackfillPanel merchantId={merchantId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Start indexing' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Indexing failed.')
    );
  });
});

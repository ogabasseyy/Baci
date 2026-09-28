import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
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

describe('dashboard catalog indexing rate limits and merchant changes', () => {
  beforeEach(() => {
    fetchWithCsrf.mockReset();
    window.localStorage.clear();
  });

  it('waits for a 429 reset and retries the same batch automatically', async () => {
    vi.useFakeTimers();
    try {
      fetchWithCsrf
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({ resetIn: 2 }),
        })
        .mockImplementationOnce(() =>
          page({ scanned: 1, generated: 1, nextCursor: null, done: true })
        );
      render(<DiscoveryBackfillPanel merchantId={merchantId} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start indexing' }));
        await Promise.resolve();
      });
      expect(fetchWithCsrf).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('status')).toHaveTextContent(
        'Waiting for the request limit to reset'
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2000);
      });
      expect(fetchWithCsrf).toHaveBeenCalledTimes(2);
      expect(screen.getByRole('status')).toHaveTextContent(
        'Indexing complete.'
      );
      expect(fetchWithCsrf.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          body: JSON.stringify({ merchantId, cursor: null }),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops immediately while waiting for the request limit', async () => {
    vi.useFakeTimers();
    try {
      fetchWithCsrf.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ resetIn: 60 }),
      });
      render(<DiscoveryBackfillPanel merchantId={merchantId} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start indexing' }));
        await Promise.resolve();
      });
      expect(screen.getByRole('status')).toHaveTextContent(
        'Waiting for the request limit to reset'
      );
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Stop after this batch' })
        );
      });
      expect(
        screen.getByRole('button', { name: 'Start indexing' })
      ).toBeEnabled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(fetchWithCsrf).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('clears old merchant progress and ignores its unfinished request after a merchant switch', async () => {
    const otherMerchantId = '33333333-3333-4333-8333-333333333333';
    let finishOldRequest: ((value: unknown) => void) | undefined;
    fetchWithCsrf
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOldRequest = resolve;
          })
      )
      .mockImplementationOnce(() =>
        page({ scanned: 1, generated: 1, nextCursor: null, done: true })
      );
    window.localStorage.setItem(
      `discovery-backfill:${merchantId}`,
      JSON.stringify({
        cursor: '22222222-2222-4222-8222-222222222222',
        complete: false,
      })
    );
    const view = render(<DiscoveryBackfillPanel merchantId={merchantId} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continue indexing' }));
    await waitFor(() => expect(fetchWithCsrf).toHaveBeenCalledTimes(1));
    const oldSignal = (fetchWithCsrf.mock.calls[0][1] as RequestInit).signal;
    view.rerender(<DiscoveryBackfillPanel merchantId={otherMerchantId} />);
    expect(oldSignal?.aborted).toBe(true);
    expect(
      screen.getByRole('button', { name: 'Start indexing' })
    ).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Start indexing' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(
        'Indexing complete. 1 scanned this visit'
      )
    );
    await act(async () => {
      finishOldRequest?.({
        ok: true,
        json: async () => ({
          scanned: 5,
          generated: 5,
          nextCursor: null,
          done: true,
        }),
      });
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'Indexing complete. 1 scanned this visit'
    );
    expect(fetchWithCsrf.mock.calls[1][1]).toEqual(
      expect.objectContaining({
        body: JSON.stringify({ merchantId: otherMerchantId, cursor: null }),
      })
    );
  });

  it('honors a server retry delay longer than one minute', async () => {
    vi.useFakeTimers();
    try {
      fetchWithCsrf
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({ resetIn: 90 }),
        })
        .mockImplementationOnce(() =>
          page({ scanned: 1, generated: 1, nextCursor: null, done: true })
        );
      render(<DiscoveryBackfillPanel merchantId={merchantId} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start indexing' }));
        await Promise.resolve();
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(fetchWithCsrf).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(30_000);
      });
      expect(fetchWithCsrf).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not restart the old merchant after switching during a quota wait', async () => {
    vi.useFakeTimers();
    try {
      const otherMerchantId = '33333333-3333-4333-8333-333333333333';
      fetchWithCsrf
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          json: async () => ({ resetIn: 90 }),
        })
        .mockImplementationOnce(() =>
          page({ scanned: 1, generated: 1, nextCursor: null, done: true })
        );
      const view = render(<DiscoveryBackfillPanel merchantId={merchantId} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start indexing' }));
        await Promise.resolve();
      });
      expect(screen.getByRole('status')).toHaveTextContent(
        'Waiting for the request limit to reset'
      );
      await act(async () => {
        view.rerender(<DiscoveryBackfillPanel merchantId={otherMerchantId} />);
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start indexing' }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(90_000);
      });
      expect(fetchWithCsrf).toHaveBeenCalledTimes(2);
      expect(fetchWithCsrf.mock.calls[1][1]).toEqual(
        expect.objectContaining({
          body: JSON.stringify({ merchantId: otherMerchantId, cursor: null }),
        })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a long retry delay within the browser timer limit', async () => {
    vi.useFakeTimers();
    const timer = vi.spyOn(window, 'setTimeout');
    try {
      fetchWithCsrf.mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ resetIn: 2_147_484 }),
      });
      render(<DiscoveryBackfillPanel merchantId={merchantId} />);
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Start indexing' }));
        await Promise.resolve();
      });
      expect(screen.getByRole('status')).toHaveTextContent(
        'Waiting for the request limit to reset'
      );
      expect(timer.mock.calls.at(-1)?.[1]).toBe(2_147_483_000);
      await act(async () => {
        fireEvent.click(
          screen.getByRole('button', { name: 'Stop after this batch' })
        );
      });
      expect(fetchWithCsrf).toHaveBeenCalledTimes(1);
    } finally {
      timer.mockRestore();
      vi.useRealTimers();
    }
  });
});

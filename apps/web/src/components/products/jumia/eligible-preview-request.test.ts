import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eligiblePreviewRequest } from './eligible-preview-request';

const selectionId = 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd';
const otherSelectionId = 'c5a0eb5e-ecc7-4142-ae9b-d7186c3d5c0b';
const merchantId = '00000000-0000-4000-8000-000000000002';

function pageFixture(id = selectionId, page = 1) {
  return {
    selectionId: id,
    total: 0,
    page,
    totalPages: 0,
    legacyUnmappedCount: 0,
    products: [],
  };
}

describe('eligiblePreviewRequest', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('loads a valid eligible page for the requested selection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(pageFixture()), { status: 200 })
    );

    await expect(
      eligiblePreviewRequest.page(merchantId, selectionId, 1)
    ).resolves.toEqual(pageFixture());
    expect(fetch).toHaveBeenCalledWith(
      `/api/marketplace/jumia/products/eligible?selectionId=${selectionId}&merchantId=${merchantId}&page=1`,
      { signal: expect.any(AbortSignal) }
    );
  });

  it('rejects an eligible page echoed for a different selection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(pageFixture(otherSelectionId)), {
        status: 200,
      })
    );

    await expect(
      eligiblePreviewRequest.page(merchantId, selectionId, 1)
    ).rejects.toMatchObject({
      status: 422,
    });
  });

  it('rejects a response that echoes a different page number', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(pageFixture(selectionId, 1)), { status: 200 })
    );

    await expect(
      eligiblePreviewRequest.page(merchantId, selectionId, 2)
    ).rejects.toMatchObject({ status: 422 });
  });

  it('maps the standardized upgrade response to actionable guidance', async () => {
    const response = new Response(
      JSON.stringify({ code: 'requires_upgrade' }),
      { status: 402 }
    );

    await expect(
      eligiblePreviewRequest.errorMessage(response, 'fallback')
    ).resolves.toMatch(/upgrade/i);
  });

  it('uses the safe fallback for an unknown upgrade response', async () => {
    const response = new Response(JSON.stringify({ code: 'other' }), {
      status: 402,
    });

    await expect(
      eligiblePreviewRequest.errorMessage(response, 'safe fallback')
    ).resolves.toBe('safe fallback');
  });

  it('classifies unreadable JSON as an invalid page response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('truncated {', { status: 200 })
    );

    await expect(
      eligiblePreviewRequest.page(merchantId, selectionId, 1)
    ).rejects.toMatchObject({
      status: 422,
    });
  });

  it('preserves cancellation while a successful response body is pending', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => new Promise(() => undefined),
    } as Response);

    const request = eligiblePreviewRequest.page(
      merchantId,
      selectionId,
      1,
      controller.signal
    );
    await vi.waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      )
    );
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not start a fetch when the lifecycle signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    await expect(
      eligiblePreviewRequest.page(merchantId, selectionId, 1, controller.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cancels an eligible request while reading an upgrade error body', async () => {
    const controller = new AbortController();
    const response = {
      ok: false,
      status: 402,
      json: () => new Promise(() => undefined),
    } as Response;
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response);
    const request = eligiblePreviewRequest.page(
      merchantId,
      selectionId,
      1,
      controller.signal
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    controller.abort();

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('bounds a stalled successful response body with a timeout', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: () => new Promise(() => undefined),
    } as Response);

    try {
      const request = eligiblePreviewRequest.page(merchantId, selectionId, 1);
      const rejected = expect(request).rejects.toMatchObject({
        name: 'TimeoutError',
      });
      await vi.advanceTimersByTimeAsync(30_000);
      await rejected;
    } finally {
      vi.useRealTimers();
    }
  });
});

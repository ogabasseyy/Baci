import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eligiblePreviewRequest } from './eligible-preview-request';

const selectionId = 'd1ef9f3a-4f2b-49af-a84f-97d19c0084bd';
const otherSelectionId = 'c5a0eb5e-ecc7-4142-ae9b-d7186c3d5c0b';

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

    await expect(eligiblePreviewRequest.page(selectionId, 1)).resolves.toEqual(
      pageFixture()
    );
  });

  it('rejects an eligible page echoed for a different selection', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(pageFixture(otherSelectionId)), {
        status: 200,
      })
    );

    await expect(
      eligiblePreviewRequest.page(selectionId, 1)
    ).rejects.toMatchObject({
      status: 422,
    });
  });

  it('rejects a response that echoes a different page number', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(pageFixture(selectionId, 1)), { status: 200 })
    );

    await expect(
      eligiblePreviewRequest.page(selectionId, 2)
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
      eligiblePreviewRequest.page(selectionId, 1)
    ).rejects.toMatchObject({
      status: 422,
    });
  });
});

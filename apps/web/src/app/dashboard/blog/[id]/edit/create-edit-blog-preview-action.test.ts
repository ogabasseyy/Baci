// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { useToast } from '@/hooks/use-toast';

const { mockGetPreviewUrl, mockSavePost, mockToast, mockWindowOpen } =
  vi.hoisted(() => ({
    mockGetPreviewUrl: vi.fn(),
    mockSavePost: vi.fn(),
    mockToast: vi.fn(),
    mockWindowOpen: vi.fn(),
  }));

vi.mock('../../actions', () => ({
  getPreviewUrl: (...args: unknown[]) => mockGetPreviewUrl(...args),
}));

const { createEditBlogPreviewAction } = await import(
  './create-edit-blog-preview-action'
);

function createAction(
  { merchantId }: { merchantId: string | undefined } = {
    merchantId: 'merchant-id-a',
  }
) {
  return createEditBlogPreviewAction({
    merchantId,
    merchantSessionRef: { current: { generation: 0, id: 'merchant-id-a' } },
    merchantSlug: 'merchant-slug-a',
    postSlug: 'post-a',
    savePost: mockSavePost,
    toast: mockToast as unknown as ReturnType<typeof useToast>['toast'],
  });
}

describe('createEditBlogPreviewAction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSavePost.mockResolvedValue(true);
    window.open = mockWindowOpen;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens the preview when the initiating merchant session remains active', async () => {
    mockGetPreviewUrl.mockResolvedValue(
      'https://merchant-a.example.com/post-a'
    );

    await createAction()();

    expect(mockGetPreviewUrl).toHaveBeenCalledWith(
      'merchant-id-a',
      'merchant-slug-a',
      'post-a'
    );
    expect(mockWindowOpen).toHaveBeenCalledWith(
      'https://merchant-a.example.com/post-a',
      '_blank'
    );
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('rejects a missing merchant ID before saving or generating a preview', async () => {
    await createAction({ merchantId: undefined })();

    expect(mockSavePost).not.toHaveBeenCalled();
    expect(mockGetPreviewUrl).not.toHaveBeenCalled();
    expect(mockWindowOpen).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Merchant slug not found.',
      variant: 'destructive',
    });
  });

  it('shows an error without opening a preview when the active session URL lookup fails', async () => {
    mockGetPreviewUrl.mockRejectedValue(new Error('Preview lookup failed'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await createAction()();

    expect(mockWindowOpen).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith({
      title: 'Error',
      description: 'Failed to generate preview link.',
      variant: 'destructive',
    });
  });
});

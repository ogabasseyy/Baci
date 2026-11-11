// @vitest-environment jsdom

import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEditBlogSession } from './use-edit-blog-merchant-session';

describe('useEditBlogSession', () => {
  it('does not advance the generation or clear saving for an unchanged merchant', () => {
    const setIsSaving = vi.fn();
    const { result, rerender } = renderHook(
      ({
        merchantId,
        postId,
      }: {
        merchantId: string | undefined;
        postId: string;
      }) => useEditBlogSession(merchantId, postId, setIsSaving),
      { initialProps: { merchantId: 'merchant-a', postId: 'post-1' } }
    );

    rerender({ merchantId: 'merchant-a', postId: 'post-1' });

    expect(result.current.current).toEqual({
      generation: 0,
      merchantId: 'merchant-a',
      postId: 'post-1',
    });
    expect(setIsSaving).not.toHaveBeenCalled();
  });

  it('creates a new generation and clears saving on every merchant transition', () => {
    const setIsSaving = vi.fn();
    const { result, rerender } = renderHook(
      ({
        merchantId,
        postId,
      }: {
        merchantId: string | undefined;
        postId: string;
      }) => useEditBlogSession(merchantId, postId, setIsSaving),
      { initialProps: { merchantId: 'merchant-a', postId: 'post-1' } }
    );

    rerender({ merchantId: 'merchant-b', postId: 'post-1' });
    rerender({ merchantId: 'merchant-a', postId: 'post-1' });

    expect(result.current.current).toEqual({
      generation: 2,
      merchantId: 'merchant-a',
      postId: 'post-1',
    });
    expect(setIsSaving).toHaveBeenCalledTimes(2);
    expect(setIsSaving).toHaveBeenLastCalledWith(false);
  });

  it('creates a new generation and clears saving when navigation changes posts', () => {
    const setIsSaving = vi.fn();
    const { result, rerender } = renderHook(
      ({ postId }: { postId: string }) =>
        useEditBlogSession('merchant-a', postId, setIsSaving),
      { initialProps: { postId: 'post-1' } }
    );

    rerender({ postId: 'post-2' });

    expect(result.current.current).toEqual({
      generation: 1,
      merchantId: 'merchant-a',
      postId: 'post-2',
    });
    expect(setIsSaving).toHaveBeenCalledWith(false);
  });
});

import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PLATFORM_BLOG_FORM_STATE } from './blog-types';
import { useBlogReviewHandoffImport } from './use-blog-review-handoff-import';

const draft = {
  ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
  content: '<p>Imported</p>',
  title: 'Imported',
};

function setup(
  overrides: Partial<Parameters<typeof useBlogReviewHandoffImport>[0]> = {}
) {
  const args = {
    contentGenerationRef: { current: 0 },
    coverStashRef: { current: null },
    form: { ...DEFAULT_PLATFORM_BLOG_FORM_STATE },
    inlineUploadsPending: false,
    invalidateFeaturedUploads: vi.fn(),
    pendingContentEditRef: { current: false },
    saving: false,
    setContentResetKey: vi.fn(),
    setForm: vi.fn(),
    ...overrides,
  };
  const hook = renderHook(() => useBlogReviewHandoffImport(args));
  return { ...hook, args };
}

describe('useBlogReviewHandoffImport', () => {
  afterEach(() => vi.restoreAllMocks());

  it('applies the draft without confirming a pristine form', () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { args, result } = setup();
    let applied = false;
    act(() => {
      applied = result.current(draft);
    });
    expect(applied).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(args.setForm).toHaveBeenCalledWith(draft);
    expect(args.setContentResetKey).toHaveBeenCalled();
    expect(args.invalidateFeaturedUploads).toHaveBeenCalled();
    expect(args.contentGenerationRef.current).toBe(1);
  });

  it('clears a stashed pre-diversion cover when the draft applies', () => {
    const { args, result } = setup({
      coverStashRef: {
        current: {
          alt: 'Stale',
          altEdited: true,
          height: 675,
          url: 'https://cdn.example.com/stale.webp',
          variants: {},
          width: 1200,
        },
      },
    });
    act(() => {
      result.current(draft);
    });
    expect(args.coverStashRef.current).toBeNull();
  });

  it('refuses to import while saving', () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { args, result } = setup({ saving: true });
    let applied = true;
    act(() => {
      applied = result.current(draft);
    });
    expect(applied).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(args.setForm).not.toHaveBeenCalled();
  });

  it('refuses to import while an inline upload is pending', () => {
    // Importing remounts the editor, abandoning the inline completion
    // callback: the persisted upload would never enter the article.
    const confirm = vi.spyOn(window, 'confirm');
    const { args, result } = setup({ inlineUploadsPending: true });
    let applied = true;
    act(() => {
      applied = result.current(draft);
    });
    expect(applied).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(args.setForm).not.toHaveBeenCalled();
    expect(args.invalidateFeaturedUploads).not.toHaveBeenCalled();
  });

  it('confirms before replacing a dirty form', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { args, result } = setup({
      form: { ...DEFAULT_PLATFORM_BLOG_FORM_STATE, title: 'Unsaved' },
    });
    let applied = true;
    act(() => {
      applied = result.current(draft);
    });
    expect(applied).toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      'Replace your unsaved article with this review handoff?'
    );
    expect(args.setForm).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    act(() => {
      applied = result.current(draft);
    });
    expect(applied).toBe(true);
    expect(args.setForm).toHaveBeenCalledWith(draft);
    expect(args.pendingContentEditRef.current).toBe(false);
  });

  it('treats a cleared optional field as pristine', () => {
    const confirm = vi.spyOn(window, 'confirm');
    const { result } = setup({
      form: {
        ...DEFAULT_PLATFORM_BLOG_FORM_STATE,
        focus_keyword: '',
        intent: null,
      },
    });
    let applied = false;
    act(() => {
      applied = result.current(draft);
    });
    expect(applied).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});

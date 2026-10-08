import type { Dispatch, RefObject, SetStateAction } from 'react';
import { areBlogImageVariantsEqual } from './are-blog-image-variants-equal';
import {
  DEFAULT_PLATFORM_BLOG_FORM_STATE,
  type PlatformAdminBlogCoverState,
  type PlatformAdminBlogFormState,
} from './blog-types';

// Absent optional fields (undefined) and cleared inputs ('') both mean "no
// value": normalize them so selecting "Not specified" or clearing an
// optional field back to empty does not flag the pristine form as dirty.
function normalizeDirtyCheckValue(value: unknown): unknown {
  return value === undefined || value === '' ? null : value;
}

function isFormDirty(form: PlatformAdminBlogFormState): boolean {
  return Object.entries(form).some(([key, value]) => {
    const baseline =
      DEFAULT_PLATFORM_BLOG_FORM_STATE[key as keyof PlatformAdminBlogFormState];
    if (key === 'featured_image_variants') {
      return !areBlogImageVariantsEqual(
        value as Record<string, unknown>,
        baseline as Record<string, unknown>
      );
    }
    return (
      JSON.stringify(normalizeDirtyCheckValue(value)) !==
      JSON.stringify(normalizeDirtyCheckValue(baseline))
    );
  });
}

type UseBlogReviewHandoffImportArgs = {
  contentGenerationRef: RefObject<number>;
  coverStashRef: RefObject<PlatformAdminBlogCoverState | null>;
  form: PlatformAdminBlogFormState;
  inlineUploadsPending: boolean;
  invalidateFeaturedUploads: () => void;
  pendingContentEditRef: RefObject<boolean>;
  saving: boolean;
  setContentResetKey: Dispatch<SetStateAction<number>>;
  setForm: Dispatch<SetStateAction<PlatformAdminBlogFormState>>;
};

export function useBlogReviewHandoffImport({
  contentGenerationRef,
  coverStashRef,
  form,
  inlineUploadsPending,
  invalidateFeaturedUploads,
  pendingContentEditRef,
  saving,
  setContentResetKey,
  setForm,
}: UseBlogReviewHandoffImportArgs): (
  draft: PlatformAdminBlogFormState
) => boolean {
  return (draft) => {
    // Importing remounts the editor, abandoning any inline completion
    // callback: the persisted upload would never enter the article, so
    // the import waits until inline uploads settle.
    if (saving || inlineUploadsPending) return false;
    if (
      (isFormDirty(form) || pendingContentEditRef.current) &&
      !window.confirm('Replace your unsaved article with this review handoff?')
    ) {
      return false;
    }
    invalidateFeaturedUploads();
    pendingContentEditRef.current = false;
    // The draft is a new baseline: a stashed pre-diversion cover belongs
    // to the replaced form and must not resurrect over the import.
    coverStashRef.current = null;
    // Synchronously invalidate any debounced body edit queued
    // before this import: its timer may already be due, and the
    // remount's passive-effect cleanup can lose that race and
    // overwrite the imported body with abandoned editor HTML.
    contentGenerationRef.current += 1;
    setForm(draft);
    setContentResetKey((current) => current + 1);
    return true;
  };
}

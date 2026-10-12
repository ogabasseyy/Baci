import type { RefObject } from 'react';
import type {
  PlatformAdminBlogCoverState,
  PlatformAdminBlogFormState,
} from './blog-types';

type ApplyCoverUrlChangeArgs = {
  coverStashRef: RefObject<PlatformAdminBlogCoverState | null>;
  current: PlatformAdminBlogFormState;
  initialCover?: PlatformAdminBlogCoverState;
  nextUrl: string;
};

export function applyCoverUrlChange({
  coverStashRef,
  current,
  initialCover,
  nextUrl,
}: ApplyCoverUrlChangeArgs): PlatformAdminBlogFormState {
  const nextTrimmed = nextUrl.trim();
  const stashed = coverStashRef.current;
  // Undoing returns to the diversion origin when one was stashed, else to
  // the pristine cover. Either way the restored record carries the alt
  // text — including any unsaved edit — from before the diversion.
  const restoreTarget = (stashed?.url ?? initialCover?.url ?? '').trim();
  const restorable = stashed ?? (initialCover?.url ? initialCover : undefined);
  if (restoreTarget !== '' && nextTrimmed === restoreTarget && restorable) {
    coverStashRef.current = null;
    return {
      ...current,
      featured_image_alt: restorable.alt,
      featured_image_alt_edited: restorable.altEdited,
      featured_image_height: restorable.height,
      featured_image_url: nextUrl,
      featured_image_variants: restorable.variants,
      featured_image_width: restorable.width,
    };
  }
  // Any other URL change orphans the whole cover record: clear the alt
  // text, dimensions, and variants together, otherwise the new image
  // inherits the old one's metadata. The create payload has no existing
  // post to reconcile against, so preserving here would publish stale
  // dimensions; uploads bypass this transition and set fresh metadata.
  const urlChanged = nextTrimmed !== current.featured_image_url.trim();
  const urlRemoved = nextTrimmed === '';
  // Only an established cover record is worth returning to: the input
  // delivers per-keystroke intermediates, so stashing a bare partial URL
  // would pin a target the completed URL can never match. Metadata (or a
  // deliberate edit) proves the origin was a real record, not mid-typing.
  const hasStashableOrigin =
    current.featured_image_url.trim() !== '' &&
    (current.featured_image_alt !== '' ||
      current.featured_image_alt_edited === true ||
      current.featured_image_height != null ||
      current.featured_image_width != null ||
      Object.keys(current.featured_image_variants).length > 0);
  if ((urlChanged || urlRemoved) && hasStashableOrigin) {
    // Preserve the pre-diversion record so that returning restores it.
    // Later hops in the same chain keep the original stash because
    // their own records were already cleared (not stashable). But an
    // intermediate URL can become an established cover after the first
    // diversion (fresh alt typed for it), and diverting away from that
    // replaces the stale stash: restoring the intermediate must recover
    // its record, not the older origin's.
    coverStashRef.current = {
      alt: current.featured_image_alt,
      altEdited: current.featured_image_alt_edited === true,
      height: current.featured_image_height,
      url: current.featured_image_url,
      variants: current.featured_image_variants,
      width: current.featured_image_width,
    };
  }
  return {
    ...current,
    featured_image_url: nextUrl,
    ...(urlChanged || urlRemoved
      ? {
          featured_image_alt: '',
          featured_image_alt_edited: false,
          featured_image_height: null,
          featured_image_variants: {},
          featured_image_width: null,
        }
      : {}),
  };
}

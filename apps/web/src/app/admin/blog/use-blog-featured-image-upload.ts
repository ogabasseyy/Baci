import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from 'react';
import type { useToast } from '@/hooks/use-toast';
import { extractManagedBlogStoragePath } from '@/lib/blog-managed-storage-paths';
import type {
  PlatformAdminBlogCoverState,
  PlatformAdminBlogFormState,
} from './blog-types';
import { draftReferencedMediaPaths } from './draft-referenced-media-paths';

type UploadResult = {
  url: string;
  width?: number | null;
  height?: number | null;
  variants?: Record<string, string>;
};

export function useBlogFeaturedImageUpload({
  upload,
  deleteUpload,
  setForm,
  toast,
  coverStashRef,
}: {
  upload: (file: File) => Promise<UploadResult>;
  deleteUpload: (paths: {
    path: string;
    variantPaths: string[];
  }) => Promise<void>;
  setForm: Dispatch<SetStateAction<PlatformAdminBlogFormState>>;
  toast: (props: Parameters<ReturnType<typeof useToast>['toast']>[0]) => void;
  coverStashRef: RefObject<PlatformAdminBlogCoverState | null>;
}) {
  const [uploadingFeatured, setUploadingFeatured] = useState(false);
  const generationRef = useRef(0);
  const altEditGenerationRef = useRef(0);
  const settledUploadsRef = useRef<UploadResult[]>([]);

  const invalidateFeaturedUploads = () => {
    generationRef.current += 1;
    setUploadingFeatured(false);
  };

  // The alt field reports every keystroke here so the upload can tell
  // mid-flight typing apart from pre-upload text, even when the final
  // value and flag converge back to what the upload started with.
  const noteAltEdit = () => {
    altEditGenerationRef.current += 1;
  };

  const cleanupInvalidatedUpload = async (result: UploadResult) => {
    // The route persisted the source and variants before this generation
    // was invalidated, so the discarded result must be deleted instead
    // of leaking. A non-managed URL is never ours to delete.
    const path = extractManagedBlogStoragePath(result.url, {
      kind: 'platform',
    });
    if (!path) return;
    const variantPaths = Object.values(result.variants ?? {})
      .map((url) => extractManagedBlogStoragePath(url, { kind: 'platform' }))
      .filter((variantPath): variantPath is string => variantPath !== null);
    try {
      await deleteUpload({ path, variantPaths });
    } catch (error) {
      toast({
        title: 'Could not remove abandoned upload',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    }
  };

  const uploadFeatured = async (file: File) => {
    const generation = ++generationRef.current;
    const altEditGeneration = altEditGenerationRef.current;
    setUploadingFeatured(true);
    try {
      const result = await upload(file);
      if (generation !== generationRef.current) {
        await cleanupInvalidatedUpload(result);
        return;
      }
      settledUploadsRef.current.push(result);
      setForm((current) => {
        // Replacing the cover orphans the alt text just like a URL edit;
        // a first upload or same-URL re-upload keeps both text and flag.
        // Alt edits made after this generation began belong to the
        // incoming image, so they survive even when the URL changes.
        const urlChanged =
          current.featured_image_url !== '' &&
          current.featured_image_url !== result.url;
        const altEditedDuringFlight =
          altEditGenerationRef.current !== altEditGeneration;
        let nextAlt = current.featured_image_alt;
        let nextAltEdited = current.featured_image_alt_edited;
        if (altEditedDuringFlight) {
          nextAltEdited = true;
        } else if (urlChanged) {
          nextAlt = '';
          nextAltEdited = false;
        }
        return {
          ...current,
          featured_image_url: result.url,
          featured_image_alt: nextAlt,
          featured_image_alt_edited: nextAltEdited,
          featured_image_width: result.width ?? null,
          featured_image_height: result.height ?? null,
          featured_image_variants: result.variants ?? {},
        };
      });
      // The upload is a new baseline: a stashed pre-diversion cover belongs
      // to the replaced URL and must not block stashing the new one.
      coverStashRef.current = null;
      toast({ title: 'Featured image uploaded' });
    } catch (error) {
      if (generation !== generationRef.current) return;
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      });
    } finally {
      if (generation === generationRef.current) setUploadingFeatured(false);
    }
  };

  const cleanupSettledSessionUploads = (
    draft: Pick<
      PlatformAdminBlogFormState,
      'content' | 'featured_image_url' | 'featured_image_variants'
    >
  ) => {
    // Settled uploads are past invalidation: when an accepted import
    // replaces the form, every tracked session result is unreferenced
    // (saves navigate away, so nothing persisted them) — except
    // objects the incoming draft itself reuses, which must be kept.
    // Both sides compare by storage path: the draft may reference the
    // same object through another public URL form (Supabase public
    // URLs vs the CDN URLs the upload returned), and the article body
    // may embed uploads the cover does not use.
    const tracked = settledUploadsRef.current;
    settledUploadsRef.current = [];
    if (tracked.length === 0) return;
    const keepPaths = draftReferencedMediaPaths(draft);
    void (async () => {
      for (const result of tracked) {
        const paths = [result.url, ...Object.values(result.variants ?? {})]
          .map((url) =>
            extractManagedBlogStoragePath(url, { kind: 'platform' })
          )
          .filter(
            (path): path is string => path !== null && !keepPaths.has(path)
          );
        if (paths.length === 0) continue;
        const [path, ...variantPaths] = paths;
        try {
          await deleteUpload({ path, variantPaths });
        } catch (error) {
          toast({
            title: 'Could not remove replaced upload',
            description:
              error instanceof Error ? error.message : 'Unknown error',
            variant: 'destructive',
          });
        }
      }
    })();
  };

  return {
    cleanupSettledSessionUploads,
    invalidateFeaturedUploads,
    noteAltEdit,
    uploadFeatured,
    uploadingFeatured,
  };
}

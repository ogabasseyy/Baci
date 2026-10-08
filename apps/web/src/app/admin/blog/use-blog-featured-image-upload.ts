import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
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

function unreferencedUploadPaths(
  result: UploadResult,
  keepPaths: Set<string>
): string[] {
  return [result.url, ...Object.values(result.variants ?? {})]
    .map((url) => extractManagedBlogStoragePath(url, { kind: 'platform' }))
    .filter((path): path is string => path !== null && !keepPaths.has(path));
}

function retainKeptUploadPaths(
  result: UploadResult,
  keepPaths: Set<string>
): UploadResult | null {
  // A result the draft partially reuses stays tracked trimmed to its
  // kept paths, so a later import deletes only what is still
  // abandoned instead of retrying already-deleted objects.
  const urlPath = extractManagedBlogStoragePath(result.url, {
    kind: 'platform',
  });
  const url = urlPath !== null && keepPaths.has(urlPath) ? result.url : '';
  const variants = Object.fromEntries(
    Object.entries(result.variants ?? {}).filter(([, variantUrl]) => {
      const variantPath = extractManagedBlogStoragePath(variantUrl, {
        kind: 'platform',
      });
      return variantPath !== null && keepPaths.has(variantPath);
    })
  );
  if (url === '' && Object.keys(variants).length === 0) return null;
  return { ...result, url, variants };
}

export function useBlogFeaturedImageUpload({
  upload,
  deleteUpload,
  setForm,
  toast,
  coverStashRef,
  formRef,
}: {
  upload: (file: File) => Promise<UploadResult>;
  deleteUpload: (paths: {
    path: string;
    variantPaths: string[];
  }) => Promise<void>;
  setForm: Dispatch<SetStateAction<PlatformAdminBlogFormState>>;
  toast: (props: Parameters<ReturnType<typeof useToast>['toast']>[0]) => void;
  coverStashRef: RefObject<PlatformAdminBlogCoverState | null>;
  formRef: RefObject<PlatformAdminBlogFormState>;
}) {
  const [uploadingFeatured, setUploadingFeatured] = useState(false);
  const generationRef = useRef(0);
  const altEditGenerationRef = useRef(0);
  const settledUploadsRef = useRef<UploadResult[]>([]);
  const pendingDeletesRef = useRef<UploadResult[]>([]);
  const deleteUploadRef = useRef(deleteUpload);
  deleteUploadRef.current = deleteUpload;

  // Deferred dispatch: cleanups only stage results — nothing is
  // deleted while a later import could still reuse it, since an
  // aborted fetch cannot recall a DELETE the server already ran.
  // The staged results flush once, on unmount (saves navigate
  // away), minus whatever the live form references: manual edits
  // after the last import can re-embed a staged path. A failed
  // flush leaks silently — there is no session left to retry in,
  // and a leak is safer than deleting live media.
  useEffect(
    () => () => {
      const keepPaths = draftReferencedMediaPaths(formRef.current);
      const paths = new Set<string>();
      for (const result of pendingDeletesRef.current) {
        for (const path of unreferencedUploadPaths(result, keepPaths)) {
          paths.add(path);
        }
      }
      if (paths.size === 0) return;
      const [path, ...variantPaths] = [...paths];
      void deleteUploadRef.current({ path, variantPaths }).catch(() => {
        // Intentionally silent: no session is left to retry in.
      });
    },
    [formRef]
  );

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
    // objects the incoming draft itself reuses, which stay tracked
    // for a later import instead of leaking untracked. Both sides
    // compare by storage path: the draft may reference the same
    // object through another public URL form (Supabase public URLs
    // vs the CDN URLs the upload returned), and the article body may
    // embed uploads the cover does not use. Unreferenced paths batch
    // into one DELETE call so a long session cannot trip the shared
    // per-minute delete budget one upload at a time.
    const keepPaths = draftReferencedMediaPaths(draft);
    // A reuse revives staged results back into tracking, trimmed
    // to their kept paths; staged originals stay put, since the
    // flush filters by live keeps and never double-deletes.
    const tracked = settledUploadsRef.current;
    for (const result of pendingDeletesRef.current) {
      const kept = retainKeptUploadPaths(result, keepPaths);
      if (kept !== null) tracked.push(kept);
    }
    if (tracked.length === 0) return;
    const retained: UploadResult[] = [];
    for (const result of tracked) {
      const kept = retainKeptUploadPaths(result, keepPaths);
      if (kept !== null) retained.push(kept);
      if (unreferencedUploadPaths(result, keepPaths).length > 0) {
        pendingDeletesRef.current.push(result);
      }
    }
    settledUploadsRef.current = retained;
  };

  return {
    cleanupSettledSessionUploads,
    invalidateFeaturedUploads,
    noteAltEdit,
    uploadFeatured,
    uploadingFeatured,
  };
}

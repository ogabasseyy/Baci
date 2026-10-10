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
import { chunkArray } from './chunk-array';
import { draftReferencedMediaPaths } from './draft-referenced-media-paths';
import { dropKeptUploadPaths } from './drop-kept-upload-paths';
import { retainKeptUploadPaths } from './retain-kept-upload-paths';
import { unreferencedUploadPaths } from './unreferenced-upload-paths';
import { uploadResultPaths } from './upload-result-paths';
import { useBlogMediaTombstoneHeartbeat } from './use-blog-media-tombstone-heartbeat';

type UploadResult = {
  url: string;
  width?: number | null;
  height?: number | null;
  variants?: Record<string, string>;
};

export function useBlogFeaturedImageUpload({
  upload,
  deleteUpload,
  refreshUpload,
  setForm,
  toast,
  coverStashRef,
  savedFormRef,
  heartbeatIntervalMs,
}: {
  upload: (file: File) => Promise<UploadResult>;
  deleteUpload: (paths: {
    path: string;
    variantPaths: string[];
  }) => Promise<void>;
  refreshUpload: (paths: string[]) => Promise<void>;
  setForm: Dispatch<SetStateAction<PlatformAdminBlogFormState>>;
  toast: (props: Parameters<ReturnType<typeof useToast>['toast']>[0]) => void;
  coverStashRef: RefObject<PlatformAdminBlogCoverState | null>;
  savedFormRef: RefObject<PlatformAdminBlogFormState | null>;
  heartbeatIntervalMs?: number;
}) {
  const [uploadingFeatured, setUploadingFeatured] = useState(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const altEditGenerationRef = useRef(0);
  const settledUploadsRef = useRef<UploadResult[]>([]);
  const pendingDeletesRef = useRef<UploadResult[]>([]);
  const deleteUploadRef = useRef(deleteUpload);
  deleteUploadRef.current = deleteUpload;

  // Deferred dispatch: cleanups only stage results — nothing is
  // deleted while a later import could still reuse it, since an
  // aborted fetch cannot recall a DELETE the server already ran.
  // The flush covers settled and staged results alike (an upload
  // discarded without any import never stages), minus the last
  // saved payload. A failed flush leaks silently — there is no
  // session left to retry in, and a leak is safer than deleting
  // live media.
  useEffect(() => {
    mountedRef.current = true; // StrictMode replays setup after cleanup.
    return () => {
      mountedRef.current = false;
      // Teardown leaves the page, so only the last server-confirmed
      // payload earns retention: live-form references are unpersisted
      // by definition here, and keeping them would orphan
      // upload-then-Back media.
      const keepPaths = new Set<string>();
      const saved = savedFormRef.current;
      if (saved !== null) {
        for (const path of draftReferencedMediaPaths(saved)) {
          keepPaths.add(path);
        }
      }
      const paths = new Set<string>();
      const candidates = [
        ...settledUploadsRef.current,
        ...pendingDeletesRef.current,
      ];
      for (const result of candidates) {
        for (const path of unreferencedUploadPaths(result, keepPaths)) {
          paths.add(path);
        }
      }
      // Supabase remove() caps at 1,000 objects per call: chunk the
      // flush and send sequentially so one oversized session cannot
      // fail the whole batch (or burst the shared rate limit).
      const send = async () => {
        for (const chunk of chunkArray([...paths], 1000)) {
          const [path, ...variantPaths] = chunk;
          try {
            await deleteUploadRef.current({ path, variantPaths });
          } catch {
            // Intentionally silent: no session is left to retry in.
          }
        }
      };
      void send();
    };
  }, [savedFormRef]);

  // Settled session uploads stage as tombstones at POST time, so an
  // editor open past the grace window must keep its unsaved uploads
  // leased: each beat extends settled paths the last saved payload
  // does not keep. Staged results stay out — they were replaced and
  // should expire.
  useBlogMediaTombstoneHeartbeat({
    getPaths: () => {
      const keepPaths = new Set<string>();
      const saved = savedFormRef.current;
      if (saved !== null) {
        for (const path of draftReferencedMediaPaths(saved)) {
          keepPaths.add(path);
        }
      }
      const paths = new Set<string>();
      for (const result of settledUploadsRef.current) {
        for (const path of unreferencedUploadPaths(result, keepPaths)) {
          paths.add(path);
        }
      }
      return [...paths];
    },
    intervalMs: heartbeatIntervalMs,
    refresh: refreshUpload,
  });

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
      // A post-teardown result deletes like an invalidated generation
      // instead of tracking into a dead ref.
      if (!mountedRef.current || generation !== generationRef.current) {
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
    // A reuse moves staged results back into tracking, trimmed to
    // their kept paths, while only the unreferenced remainder stays
    // staged: copying would double the tracked entries on every
    // retain/discard cycle.
    const tracked = settledUploadsRef.current;
    const stillPending: UploadResult[] = [];
    const revived: string[] = [];
    for (const result of pendingDeletesRef.current) {
      const kept = retainKeptUploadPaths(result, keepPaths);
      if (kept !== null) {
        tracked.push(kept);
        revived.push(...uploadResultPaths(kept));
      }
      const remainder = dropKeptUploadPaths(result, keepPaths);
      if (remainder !== null) stillPending.push(remainder);
    }
    pendingDeletesRef.current = stillPending;
    // A revived upload's tombstone may already be due: refresh it
    // now instead of waiting for the next heartbeat, or the sweep
    // claims the newly reused image in the gap. Failures stay
    // silent for the next beat to retry, like the heartbeat itself.
    if (revived.length > 0) void refreshUpload(revived).catch(() => undefined);
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

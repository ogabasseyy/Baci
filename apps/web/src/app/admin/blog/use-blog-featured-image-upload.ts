import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useRef,
  useState,
} from 'react';
import type { useToast } from '@/hooks/use-toast';
import type {
  PlatformAdminBlogCoverState,
  PlatformAdminBlogFormState,
} from './blog-types';

type UploadResult = {
  url: string;
  width?: number | null;
  height?: number | null;
  variants?: Record<string, string>;
};

export function useBlogFeaturedImageUpload({
  upload,
  setForm,
  toast,
  coverStashRef,
}: {
  upload: (file: File) => Promise<UploadResult>;
  setForm: Dispatch<SetStateAction<PlatformAdminBlogFormState>>;
  toast: (props: Parameters<ReturnType<typeof useToast>['toast']>[0]) => void;
  coverStashRef: RefObject<PlatformAdminBlogCoverState | null>;
}) {
  const [uploadingFeatured, setUploadingFeatured] = useState(false);
  const generationRef = useRef(0);

  const invalidateFeaturedUploads = () => {
    generationRef.current += 1;
    setUploadingFeatured(false);
  };

  const uploadFeatured = async (
    file: File,
    altAtUploadStart: { alt: string; altEdited: boolean }
  ) => {
    const generation = ++generationRef.current;
    setUploadingFeatured(true);
    try {
      const result = await upload(file);
      if (generation !== generationRef.current) return;
      setForm((current) => {
        // Replacing the cover orphans the alt text just like a URL edit;
        // a first upload or same-URL re-upload keeps both text and flag.
        // Alt edits made after this generation began belong to the
        // incoming image, so they survive even when the URL changes: the
        // flag half catches a type-then-clear flight that converges back
        // to the snapshot value.
        const urlChanged =
          current.featured_image_url !== '' &&
          current.featured_image_url !== result.url;
        const altEditedDuringFlight =
          current.featured_image_alt !== altAtUploadStart.alt ||
          (current.featured_image_alt_edited && !altAtUploadStart.altEdited);
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

  return { uploadingFeatured, uploadFeatured, invalidateFeaturedUploads };
}

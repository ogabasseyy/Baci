import { type Dispatch, type SetStateAction, useRef, useState } from 'react';
import type { useToast } from '@/hooks/use-toast';
import type { PlatformAdminBlogFormState } from './blog-types';

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
}: {
  upload: (file: File) => Promise<UploadResult>;
  setForm: Dispatch<SetStateAction<PlatformAdminBlogFormState>>;
  toast: (props: Parameters<ReturnType<typeof useToast>['toast']>[0]) => void;
}) {
  const [uploadingFeatured, setUploadingFeatured] = useState(false);
  const generationRef = useRef(0);

  const invalidateFeaturedUploads = () => {
    generationRef.current += 1;
    setUploadingFeatured(false);
  };

  const uploadFeatured = async (file: File) => {
    const generation = ++generationRef.current;
    setUploadingFeatured(true);
    try {
      const result = await upload(file);
      if (generation !== generationRef.current) return;
      setForm((current) => {
        // Replacing the cover orphans the alt text just like a URL edit;
        // a first upload or same-URL re-upload keeps both text and flag.
        const urlChanged =
          current.featured_image_url !== '' &&
          current.featured_image_url !== result.url;
        return {
          ...current,
          featured_image_url: result.url,
          featured_image_alt: urlChanged ? '' : current.featured_image_alt,
          featured_image_alt_edited: urlChanged
            ? false
            : current.featured_image_alt_edited,
          featured_image_width: result.width ?? null,
          featured_image_height: result.height ?? null,
          featured_image_variants: result.variants ?? {},
        };
      });
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

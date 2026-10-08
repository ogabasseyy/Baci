import { useState } from 'react';

/**
 * Track pending inline-image uploads so imports wait until they settle:
 * importing remounts the editor, which would abandon the upload's
 * completion callback and strand the persisted file.
 */
export function useBlogInlineImageUpload({
  upload,
}: {
  upload: (file: File) => Promise<{ url: string }>;
}) {
  const [pendingInlineUploads, setPendingInlineUploads] = useState(0);

  const uploadInlineImage = (file: File) => {
    setPendingInlineUploads((count) => count + 1);
    return upload(file)
      .finally(() => {
        setPendingInlineUploads((count) => count - 1);
      })
      .then((result) => result.url);
  };

  return {
    inlineUploadsPending: pendingInlineUploads > 0,
    uploadInlineImage,
  };
}

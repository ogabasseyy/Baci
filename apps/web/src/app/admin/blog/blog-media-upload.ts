import { fetchWithCsrf } from '@/lib/api-client';

type BlogMediaUploadResult = {
  height?: number | null;
  url: string;
  variants?: Record<string, string>;
  width?: number | null;
};

export async function uploadBlogMedia(
  file: File,
  purpose: 'featured' | 'inline'
): Promise<BlogMediaUploadResult> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('purpose', purpose);

  const response = await fetchWithCsrf('/api/admin/blog/upload', {
    body: formData,
    method: 'POST',
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(payload?.error || 'Failed to upload image');
  }

  const payload = (await response.json()) as Partial<BlogMediaUploadResult>;
  if (!payload.url) {
    throw new Error('Upload response did not include a URL');
  }

  return {
    height: payload.height ?? null,
    url: payload.url,
    variants: payload.variants ?? {},
    width: payload.width ?? null,
  };
}

import { readEditorApiError } from '@/components/blog-editor/blog-editor-helpers';
import { createUploadFormData } from '@/lib/upload/createUploadFormData';

interface RequestBlogEditorAiEditOptions {
  accessToken: string;
  apiUrl: string;
  content: string;
  instruction: string;
  timeoutMs?: number;
}

interface UploadBlogEditorImageOptions {
  accessToken: string;
  apiUrl: string;
  asset: {
    fileName?: string | null;
    mimeType?: string | null;
    uri: string;
  };
}

interface UploadedBlogEditorImage {
  path: string;
  url: string;
}

interface DeleteBlogEditorImageOptions {
  accessToken: string;
  apiUrl: string;
  path: string;
}

export async function requestBlogEditorAiEdit({
  accessToken,
  apiUrl,
  content,
  instruction,
  timeoutMs = 15000,
}: RequestBlogEditorAiEditOptions): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(`${apiUrl}/api/ai/edit-blog`, {
      body: JSON.stringify({ content, instruction }),
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      method: 'POST',
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await readEditorApiError(response, 'AI edit failed'));
    }

    const data = await response.json();
    if (typeof data?.content !== 'string') {
      throw new Error('AI edit failed: response did not include content');
    }

    if (data.content.trim().length === 0) {
      throw new Error('AI edit failed: empty content');
    }

    return data.content;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`AI edit timed out after ${timeoutMs}ms`, {
        cause: error,
      });
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function uploadBlogEditorImageDetails({
  accessToken,
  apiUrl,
  asset,
}: UploadBlogEditorImageOptions): Promise<UploadedBlogEditorImage> {
  const formData = await createUploadFormData({
    name: asset.fileName || `image-${Date.now()}.png`,
    type: asset.mimeType || 'image/png',
    uri: asset.uri,
  });

  const response = await fetch(`${apiUrl}/api/merchant/blog/upload`, {
    body: formData,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(await readEditorApiError(response, 'Upload failed'));
  }

  const data = await response.json();
  if (
    typeof data?.url !== 'string' ||
    data.url.length === 0 ||
    typeof data?.path !== 'string' ||
    data.path.length === 0
  ) {
    throw new Error('Upload API response did not include file details');
  }

  return { path: data.path, url: data.url };
}

export async function uploadBlogEditorImage(
  options: UploadBlogEditorImageOptions
): Promise<string> {
  const { url } = await uploadBlogEditorImageDetails(options);
  return url;
}

export async function deleteBlogEditorImage({
  accessToken,
  apiUrl,
  path,
}: DeleteBlogEditorImageOptions): Promise<void> {
  const response = await fetch(`${apiUrl}/api/merchant/blog/upload`, {
    body: JSON.stringify({ path }),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await readEditorApiError(response, 'Delete failed'));
  }

  const data = await response.json();
  if (data?.success !== true) {
    throw new Error('Delete API response did not confirm success');
  }
}

import { File, Paths } from 'expo-file-system';
import { apiClient } from '@/lib/api-client';
import type { RNFormData } from '@/types/upload';

export async function postFaviconBestEffort(file: {
  uri: string;
  name: string;
  type: string;
}): Promise<void> {
  try {
    const formData = new FormData() as unknown as RNFormData;
    formData.append('file', file);
    await apiClient('/api/merchant/favicon', {
      method: 'POST',
      body: formData as unknown as FormData,
    });
  } catch {
    // Non-blocking favicon generation.
  }
}

/**
 * Writes decoded AI-generated logo bytes to a temporary cache file so React
 * Native FormData receives a real `file://` URI (not a `data:` string) when
 * posting to `/api/merchant/favicon`, then cleans up the temp file.
 */
export async function postBytesFaviconBestEffort(params: {
  bytes: Uint8Array;
  fileExt: string;
  contentType: string;
}): Promise<void> {
  let tempFile: File | null = null;
  try {
    tempFile = new File(
      Paths.cache,
      `onboarding-logo-${Date.now()}.${params.fileExt}`
    );
    tempFile.write(params.bytes);
    await postFaviconBestEffort({
      uri: tempFile.uri,
      name: `store-logo.${params.fileExt}`,
      type: params.contentType,
    });
  } catch {
    // Non-blocking favicon generation.
  } finally {
    try {
      tempFile?.delete();
    } catch {
      // Ignore temp file cleanup errors.
    }
  }
}

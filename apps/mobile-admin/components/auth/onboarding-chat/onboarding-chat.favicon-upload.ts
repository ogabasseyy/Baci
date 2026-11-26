import { File, Paths } from 'expo-file-system';
import { ONBOARDING_ASSIST_TIMEOUT_MS } from '@/hooks/useOnboardingAssist';
import { apiClient } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';
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

function isRetryableColorExtractError(error: unknown): boolean {
  const status =
    typeof error === 'object' && error !== null && 'statusCode' in error
      ? (error as { statusCode?: unknown }).statusCode
      : undefined;
  if (typeof status === 'number') {
    return status >= 500;
  }
  return true;
}

export async function extractAndPersistUploadedLogoColors(params: {
  logoUrl: string;
  merchantId: string;
  businessName: string;
  businessType: string;
}): Promise<boolean> {
  const payload = JSON.stringify({
    task: 'extract_colors',
    logoUrl: params.logoUrl,
    businessName: params.businessName,
    businessType: params.businessType,
    brandPreferences: 'Extract from uploaded logo',
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await apiClient<{
        brandColors?: { primary: string; background: string; accent: string };
      }>('/api/mobile/onboarding-assist', {
        method: 'POST',
        timeout: ONBOARDING_ASSIST_TIMEOUT_MS,
        body: payload,
      });
      if (!result.brandColors) return false;
      const { error } = await supabase
        .from('merchants')
        .update({ brand_colors: result.brandColors })
        .eq('id', params.merchantId);
      if (error) {
        console.warn('Onboarding brand_colors update failed:', error.message);
        return false;
      }
      return true;
    } catch (error) {
      if (!isRetryableColorExtractError(error) || attempt === 1) {
        console.warn(
          'Onboarding uploaded logo color extraction failed:',
          error instanceof Error ? error.message : String(error)
        );
        return false;
      }
    }
  }
  return false;
}

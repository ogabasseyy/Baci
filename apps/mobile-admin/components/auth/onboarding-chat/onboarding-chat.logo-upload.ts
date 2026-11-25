import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { ONBOARDING_ASSIST_TIMEOUT_MS } from '@/hooks/useOnboardingAssist';
import { apiClient } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';
import { readUploadBytes } from '@/lib/upload/readUploadBytes';
import type { RNFormData } from '@/types/upload';

export interface PickedLogoAsset {
  uri: string;
  fileName: string;
  mimeType: string;
}

const DATA_URI_IMAGE_PATTERN =
  /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i;

const ALLOWED_UPLOAD_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
]);

function normalizeUploadImageMime(mimeType: string): string {
  const lower = mimeType.trim().toLowerCase();
  return lower === 'image/jpg' ? 'image/jpeg' : lower;
}

function decodeBase64ToBytes(base64: string): Uint8Array {
  const cleaned = base64.replace(/\s+/g, '');
  const binary = globalThis.atob(cleaned);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function extensionForImageMime(mimeType: string): string {
  const subtype = mimeType.split('/')[1]?.toLowerCase() ?? 'png';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg+xml') return 'svg';
  return subtype;
}

async function persistLogoBytesToMerchant(params: {
  bytes: ArrayBuffer | Uint8Array;
  contentType: string;
  fileExt: string;
  merchantId: string;
}): Promise<string | null> {
  const { bytes, contentType, fileExt, merchantId } = params;
  const filePath = `${merchantId}/${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('media')
    .upload(filePath, bytes, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    console.warn('Onboarding logo storage upload failed:', uploadError.message);
    return null;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from('media').getPublicUrl(filePath);

  const { error: updateError } = await supabase
    .from('merchants')
    .update({ logo_url: publicUrl })
    .eq('id', merchantId);

  if (updateError) {
    console.warn(
      'Onboarding merchant logo_url update failed:',
      updateError.message
    );
    return null;
  }

  return publicUrl;
}

export async function pickOnboardingLogo(): Promise<PickedLogoAsset | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    Alert.alert(
      'Permission Required',
      'Please allow access to your photo library to upload your store logo.'
    );
    return null;
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
  });

  if (result.canceled || !result.assets[0]) {
    return null;
  }

  const asset = result.assets[0];
  const uriExt = asset.uri.split('.').pop()?.toLowerCase();
  const fileNameExt = asset.fileName?.split('.').pop()?.toLowerCase();
  const fallbackExt = fileNameExt || uriExt || 'png';
  const rawMime =
    asset.mimeType ||
    `image/${fallbackExt === 'jpg' ? 'jpeg' : fallbackExt === 'svg' ? 'svg+xml' : fallbackExt}`;
  const mimeType = normalizeUploadImageMime(rawMime);
  if (!ALLOWED_UPLOAD_IMAGE_MIMES.has(mimeType)) {
    Alert.alert(
      'Unsupported Format',
      'Please choose a PNG, JPEG, or WebP image for your store logo.'
    );
    return null;
  }
  const fileExt = extensionForImageMime(mimeType);

  return {
    uri: asset.uri,
    fileName: asset.fileName || `store-logo.${fileExt}`,
    mimeType,
  };
}

/**
 * Persists a locally picked onboarding logo to Supabase Storage (`media` bucket)
 * and updates `merchants.logo_url`, then triggers favicon variant generation.
 */
export async function uploadPickedLogoBestEffort(
  asset: PickedLogoAsset,
  merchantId: string
): Promise<string | null> {
  const mimeType = normalizeUploadImageMime(asset.mimeType);
  if (!ALLOWED_UPLOAD_IMAGE_MIMES.has(mimeType)) {
    console.warn('Rejected unsupported onboarding logo MIME type:', mimeType);
    return null;
  }

  let persistedUrl: string | null = null;
  try {
    const fileExt = extensionForImageMime(mimeType);
    const bytes = await readUploadBytes(asset.uri);
    persistedUrl = await persistLogoBytesToMerchant({
      bytes,
      contentType: mimeType,
      fileExt,
      merchantId,
    });
  } catch (error) {
    console.warn('Onboarding logo upload failed:', error);
  }

  try {
    const formData = new FormData() as unknown as RNFormData;
    formData.append('file', {
      uri: asset.uri,
      name: asset.fileName,
      type: asset.mimeType,
    });
    await apiClient('/api/merchant/favicon', {
      method: 'POST',
      body: formData as unknown as FormData,
    });
  } catch {
    // Non-blocking favicon generation.
  }

  return persistedUrl;
}

/**
 * Decodes an accepted AI-generated `data:image/...;base64,...` logo, uploads it
 * to Supabase Storage (`media` bucket), and persists `merchants.logo_url`.
 */
export async function uploadDataUriLogoBestEffort(
  dataUri: string,
  merchantId: string
): Promise<string | null> {
  const match = DATA_URI_IMAGE_PATTERN.exec(dataUri.trim());
  if (!match) {
    return null;
  }
  const [, rawContentType, base64Payload] = match;
  const contentType = normalizeUploadImageMime(rawContentType);
  if (!ALLOWED_UPLOAD_IMAGE_MIMES.has(contentType)) {
    console.warn(
      'Rejected unsupported onboarding data-URI logo MIME type:',
      contentType
    );
    return null;
  }
  try {
    const bytes = decodeBase64ToBytes(base64Payload);
    return await persistLogoBytesToMerchant({
      bytes,
      contentType,
      fileExt: extensionForImageMime(contentType),
      merchantId,
    });
  } catch (error) {
    console.warn('Onboarding generated logo upload failed:', error);
    return null;
  }
}

export async function extractAndPersistUploadedLogoColors(params: {
  logoUrl: string;
  merchantId: string;
  businessName: string;
  businessType: string;
}): Promise<void> {
  try {
    const result = await apiClient<{
      brandColors?: { primary: string; background: string; accent: string };
    }>('/api/mobile/onboarding-assist', {
      method: 'POST',
      timeout: ONBOARDING_ASSIST_TIMEOUT_MS,
      body: JSON.stringify({
        task: 'extract_colors',
        logoUrl: params.logoUrl,
        businessName: params.businessName,
        businessType: params.businessType,
        brandPreferences: 'Extract from uploaded logo',
      }),
    });
    if (!result.brandColors) return;
    const { error } = await supabase
      .from('merchants')
      .update({ brand_colors: result.brandColors })
      .eq('id', params.merchantId);
    if (error) {
      console.warn('Onboarding brand_colors update failed:', error.message);
    }
  } catch {
    // Non-blocking color extraction.
  }
}

export async function persistProvisionedStoreLogo(params: {
  merchantId: string;
  logoUrl: string;
  pickedAsset: PickedLogoAsset | null;
  businessName: string;
  businessType: string;
}): Promise<boolean> {
  const { merchantId, logoUrl, pickedAsset, businessName, businessType } =
    params;
  if (pickedAsset && logoUrl === pickedAsset.uri) {
    const uploadedUrl = await uploadPickedLogoBestEffort(
      pickedAsset,
      merchantId
    );
    if (!uploadedUrl) return false;
    await extractAndPersistUploadedLogoColors({
      logoUrl: uploadedUrl,
      merchantId,
      businessName,
      businessType,
    });
    return true;
  }
  if (logoUrl.startsWith('data:image/')) {
    const persistedUrl = await uploadDataUriLogoBestEffort(logoUrl, merchantId);
    return Boolean(persistedUrl);
  }
  if (!logoUrl || /^https?:\/\//i.test(logoUrl)) {
    return true;
  }
  return false;
}

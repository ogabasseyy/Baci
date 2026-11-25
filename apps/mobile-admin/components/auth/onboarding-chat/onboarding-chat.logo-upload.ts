import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
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
}): Promise<void> {
  const { bytes, contentType, fileExt, merchantId } = params;
  const filePath = `${merchantId}/${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('media')
    .upload(filePath, bytes, {
      contentType,
      upsert: true,
    });

  if (uploadError) {
    return;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from('media').getPublicUrl(filePath);

  await supabase
    .from('merchants')
    .update({ logo_url: publicUrl })
    .eq('id', merchantId);
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
  });

  if (result.canceled || !result.assets[0]) {
    return null;
  }

  const asset = result.assets[0];
  const uriExt = asset.uri.split('.').pop()?.toLowerCase();
  const fileNameExt = asset.fileName?.split('.').pop()?.toLowerCase();
  const fallbackExt = fileNameExt || uriExt || 'png';
  const mimeType =
    asset.mimeType || `image/${fallbackExt === 'jpg' ? 'jpeg' : fallbackExt}`;
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
): Promise<void> {
  try {
    const fileExt =
      asset.fileName.split('.').pop()?.toLowerCase() ||
      extensionForImageMime(asset.mimeType);
    const bytes = await readUploadBytes(asset.uri);
    await persistLogoBytesToMerchant({
      bytes,
      contentType: asset.mimeType,
      fileExt,
      merchantId,
    });
  } catch {
    // Non-blocking: store is already provisioned and merchant can re-upload in settings.
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
}

/**
 * Decodes an accepted AI-generated `data:image/...;base64,...` logo, uploads it
 * to Supabase Storage (`media` bucket), and persists `merchants.logo_url`.
 */
export async function uploadDataUriLogoBestEffort(
  dataUri: string,
  merchantId: string
): Promise<void> {
  const match = DATA_URI_IMAGE_PATTERN.exec(dataUri.trim());
  if (!match) {
    return;
  }
  const [, contentType, base64Payload] = match;
  try {
    const bytes = decodeBase64ToBytes(base64Payload);
    await persistLogoBytesToMerchant({
      bytes,
      contentType,
      fileExt: extensionForImageMime(contentType),
      merchantId,
    });
  } catch {
    // Non-blocking: store is already provisioned and merchant can update logo in settings.
  }
}

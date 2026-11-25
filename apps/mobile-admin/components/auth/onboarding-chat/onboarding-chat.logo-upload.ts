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
  const mimeExt = mimeType.split('/')[1]?.toLowerCase();
  const fileExt = mimeExt === 'jpeg' ? 'jpg' : mimeExt || fallbackExt;

  return {
    uri: asset.uri,
    fileName: asset.fileName || `store-logo.${fileExt}`,
    mimeType,
  };
}

/**
 * Persists a locally picked onboarding logo to Supabase Storage (`media` bucket)
 * and updates `merchants.logo_url` (matching `LogoPicker`), then triggers
 * favicon variant generation as a best-effort follow-up.
 */
export async function uploadPickedLogoBestEffort(
  asset: PickedLogoAsset,
  merchantId: string
): Promise<void> {
  try {
    const fileExt =
      asset.fileName.split('.').pop()?.toLowerCase() ||
      asset.uri.split('.').pop()?.toLowerCase() ||
      'png';
    const filePath = `${merchantId}/${Date.now()}.${fileExt}`;
    const fileBytes = await readUploadBytes(asset.uri);

    const { error: uploadError } = await supabase.storage
      .from('media')
      .upload(filePath, fileBytes, {
        contentType: asset.mimeType,
        upsert: true,
      });

    if (!uploadError) {
      const {
        data: { publicUrl },
      } = supabase.storage.from('media').getPublicUrl(filePath);

      await supabase
        .from('merchants')
        .update({ logo_url: publicUrl })
        .eq('id', merchantId);
    }
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

import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { apiClient } from '@/lib/api-client';
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

export async function uploadPickedLogoBestEffort(
  asset: PickedLogoAsset
): Promise<void> {
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
    // Non-blocking: store is already provisioned and merchant can re-upload in settings.
  }
}

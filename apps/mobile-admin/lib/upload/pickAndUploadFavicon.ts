import type { QueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import { BASE_URL } from '@/lib/api-client';
import { supabase } from '@/lib/supabase';
import { createUploadFormData } from './createUploadFormData';

/** Picks a store image, sends it to the favicon API, and refreshes merchant data. */
export async function pickAndUploadFavicon(
  setIsUploading: (uploading: boolean) => void,
  queryClient: Pick<QueryClient, 'invalidateQueries'>
): Promise<void> {
  try {
    const permissionResult =
      await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permissionResult.granted) {
      Alert.alert(
        'Permission Required',
        'Please allow access to your photo library to change your favicon.'
      );
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled || !result.assets[0]) return;

    setIsUploading(true);
    const asset = result.assets[0];
    const uriExt = asset.uri.split('.').pop()?.toLowerCase();
    const fileNameExt = asset.fileName?.split('.').pop()?.toLowerCase();
    const fallbackExt = fileNameExt || uriExt || 'png';
    const mimeType =
      asset.mimeType || `image/${fallbackExt === 'jpg' ? 'jpeg' : fallbackExt}`;
    const mimeExt = mimeType.split('/')[1]?.toLowerCase();
    const fileExt = mimeExt === 'jpeg' ? 'jpg' : mimeExt || fallbackExt;
    const fileName = asset.fileName || `favicon.${fileExt}`;

    const formData = createUploadFormData({
      uri: asset.uri,
      name: fileName,
      type: mimeType,
    });

    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Your session has expired. Please sign in again.');
    }

    const response = await fetch(`${BASE_URL}/api/merchant/favicon`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: formData,
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    if (!response.ok) {
      throw new Error(payload?.error || 'Failed to update favicon');
    }

    queryClient.invalidateQueries({ queryKey: ['merchant'] });
    Alert.alert('Success', 'Favicon updated successfully!');
  } catch (error) {
    console.error('Error updating favicon:', error);
    Alert.alert(
      'Error',
      error instanceof Error
        ? error.message
        : 'Failed to update favicon. Please try again.'
    );
  } finally {
    setIsUploading(false);
  }
}

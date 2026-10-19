import * as ImagePicker from 'expo-image-picker';
import type { Dispatch, SetStateAction } from 'react';
import { Alert } from 'react-native';
import type { ProductEditFormData } from '@/components/product/product-edit.types';
import { supabase } from '@/lib/supabase';
import { readUploadBytes } from '@/lib/upload/readUploadBytes';

interface PickerResult {
  assets?: Array<{ uri: string }> | null;
  canceled: boolean;
}

interface PermissionResult {
  status: string;
}

interface CreateProductEditImageActionsParams {
  merchantId?: string;
  setFormData: Dispatch<SetStateAction<ProductEditFormData>>;
  setIsUploading: Dispatch<SetStateAction<boolean>>;
}

export function createProductEditImageActions({
  merchantId,
  setFormData,
  setIsUploading,
}: CreateProductEditImageActionsParams) {
  const uploadImage = async (uri: string) => {
    if (!merchantId) {
      return;
    }

    setIsUploading(true);
    try {
      const rawExt =
        uri.split('?')[0].split('/').pop()?.split('.').pop()?.toLowerCase() ||
        'jpg';
      const ALLOWED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'heic'];
      const fileExt = ALLOWED_EXTS.includes(rawExt) ? rawExt : 'jpg';
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${merchantId}/products/${fileName}`;
      const fileData = await readUploadBytes(uri);

      const { error } = await supabase.storage
        .from('media')
        .upload(filePath, fileData, {
          contentType: `image/${fileExt === 'jpg' ? 'jpeg' : fileExt}`,
          upsert: true,
        });

      if (error) {
        throw error;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from('media').getPublicUrl(filePath);

      setFormData((previous) => ({
        ...previous,
        images: [...(previous.images || []), publicUrl],
      }));
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to upload image';
      console.error('Upload error:', error);
      Alert.alert('Error', message);
    } finally {
      setIsUploading(false);
    }
  };

  const pickImage = async ({
    launchPicker,
    permissionDeniedMessage,
    requestPermission,
  }: {
    launchPicker: () => Promise<PickerResult>;
    permissionDeniedMessage: string;
    requestPermission: () => Promise<PermissionResult>;
  }) => {
    try {
      const { status } = await requestPermission();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', permissionDeniedMessage);
        return;
      }

      const result = await launchPicker();
      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset) {
        throw new Error('No image was selected. Please try again.');
      }

      await uploadImage(asset.uri);
    } catch (error: unknown) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unable to select an image. Please try again.';
      console.error('Image selection error:', error);
      Alert.alert('Image Selection Failed', message);
    }
  };

  const handleImagePick = () => {
    if (!merchantId) {
      Alert.alert(
        'Error',
        'Your store is not ready for image uploads. Please try again.'
      );
      return;
    }

    Alert.alert('Upload Image', 'Choose an option', [
      {
        onPress: () =>
          pickImage({
            launchPicker: () =>
              ImagePicker.launchCameraAsync({
                allowsEditing: true,
                aspect: [1, 1],
                mediaTypes: ['images'],
                quality: 0.8,
              }),
            permissionDeniedMessage:
              'Camera permission is required to take photos.',
            requestPermission: () =>
              ImagePicker.requestCameraPermissionsAsync(),
          }),
        text: 'Take Photo',
      },
      {
        onPress: () =>
          pickImage({
            launchPicker: () =>
              ImagePicker.launchImageLibraryAsync({
                allowsEditing: true,
                aspect: [1, 1],
                mediaTypes: ['images'],
                quality: 0.8,
              }),
            permissionDeniedMessage:
              'Photo library access is required to choose images.',
            requestPermission: () =>
              ImagePicker.requestMediaLibraryPermissionsAsync(),
          }),
        text: 'Choose from Library',
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return {
    handleImagePick,
  };
}

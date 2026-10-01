import Ionicons from '@react-native-vector-icons/ionicons';
import * as ImagePicker from 'expo-image-picker';
import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import SafeImage from '@/components/ui/SafeImage';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { readUploadBytes } from '@/lib/upload/readUploadBytes';

interface LogoPickerProps {
  merchantId: string | undefined;
  cachedLogoUri: string | null;
  fallbackLogoUri: string | null;
  businessName: string;
  onUploadSuccess: () => void;
  onStatusChange: (status: {
    visible: boolean;
    type: 'success' | 'error';
    title: string;
    message: string;
  }) => void;
}

async function uploadLogoToStorage(
  uri: string,
  merchantId: string
): Promise<void> {
  const fileExt = uri.split('.').pop()?.toLowerCase() || 'jpg';
  const fileName = `${Date.now()}.${fileExt}`;
  const filePath = `${merchantId}/${fileName}`;

  let mimeType = 'image/jpeg';
  if (fileExt === 'png') mimeType = 'image/png';
  else if (fileExt === 'svg') mimeType = 'image/svg+xml';
  else if (fileExt === 'webp') mimeType = 'image/webp';
  else if (fileExt === 'gif') mimeType = 'image/gif';

  const fileData = await readUploadBytes(uri);

  const { error: uploadError } = await supabase.storage
    .from('media')
    .upload(filePath, fileData, {
      contentType: mimeType,
      upsert: true,
    });

  if (uploadError) throw uploadError;

  const {
    data: { publicUrl },
  } = supabase.storage.from('media').getPublicUrl(filePath);

  const { error: updateError } = await supabase
    .from('merchants')
    .update({ logo_url: publicUrl })
    .eq('id', merchantId);

  if (updateError) throw updateError;
}

export function LogoPicker({
  merchantId,
  cachedLogoUri,
  fallbackLogoUri,
  businessName,
  onUploadSuccess,
  onStatusChange,
}: LogoPickerProps) {
  const { colors } = useTheme();
  const [isUploading, setIsUploading] = useState(false);

  const handleImagePick = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets[0]) {
        const asset = result.assets[0];
        await uploadLogo(asset.uri);
      }
    } catch (error) {
      console.error('Pick image error:', error);
      onStatusChange({
        visible: true,
        type: 'error',
        title: 'Image Selection Failed',
        message: 'Failed to select image from gallery',
      });
    }
  };

  const uploadLogo = async (uri: string) => {
    if (!merchantId) return;
    setIsUploading(true);

    try {
      await uploadLogoToStorage(uri, merchantId);
      onUploadSuccess();
      onStatusChange({
        visible: true,
        type: 'success',
        title: 'Logo Updated',
        message: 'Your store logo has been updated successfully.',
      });
    } catch (error: unknown) {
      const err = error as Error;
      console.error('Upload error:', err);
      onStatusChange({
        visible: true,
        type: 'error',
        title: 'Upload Failed',
        message: err.message || 'Failed to upload logo',
      });
    }
    setIsUploading(false);
  };

  return (
    <View style={styles.logoContainer}>
      {cachedLogoUri ? (
        <SafeImage
          fallbackSource={
            fallbackLogoUri ? { uri: fallbackLogoUri } : undefined
          }
          source={{ uri: cachedLogoUri }}
          style={styles.logo}
          contentFit="contain"
          resizeMethod="resize"
        />
      ) : (
        <View
          style={[styles.logoPlaceholder, { backgroundColor: colors.primary }]}
        >
          <Text
            style={[
              styles.logoPlaceholderText,
              { color: colors.textOnPrimary },
            ]}
          >
            {businessName.charAt(0).toUpperCase() || 'S'}
          </Text>
        </View>
      )}
      <Pressable
        style={({ pressed }) => [
          styles.changeLogoButton,
          { borderColor: colors.border },
          pressed && { opacity: 0.7 },
        ]}
        onPress={handleImagePick}
        disabled={isUploading}
        accessibilityRole="button"
        accessibilityLabel={
          isUploading ? 'Uploading store logo' : 'Change store logo'
        }
        accessibilityHint="Opens image gallery to select a new logo"
        accessibilityState={{ disabled: isUploading }}
      >
        {isUploading ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <>
            <Ionicons
              name="camera-outline"
              size={20}
              color={colors.textSecondary}
            />
            <Text
              style={[styles.changeLogoText, { color: colors.textSecondary }]}
            >
              Change
            </Text>
          </>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.lg,
  },
  logo: { width: 80, height: 80, borderRadius: RADIUS.lg },
  logoPlaceholder: {
    width: 80,
    height: 80,
    borderRadius: RADIUS.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoPlaceholderText: {
    fontSize: 32,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
  },
  changeLogoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderWidth: 1,
    borderRadius: RADIUS.md,
  },
  changeLogoText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
});

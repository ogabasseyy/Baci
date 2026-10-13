import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { palette } from '@/constants/Colors';
import { negotiationModalViewStyles as styles } from './NegotiationModalView.styles';

type NegotiationUploadFormProps = {
  message: string;
  uploadFile: string | null;
  uploadLink: string;
  phone: string;
  onPickImage: () => void;
  onUploadLinkChange: (value: string) => void;
  onPhoneChange: (value: string) => void;
  onBackFromUpload: () => void;
  onUploadSubmit: () => void;
};

export function NegotiationUploadForm({
  message,
  uploadFile,
  uploadLink,
  phone,
  onPickImage,
  onUploadLinkChange,
  onPhoneChange,
  onBackFromUpload,
  onUploadSubmit,
}: NegotiationUploadFormProps) {
  return (
    <Animated.View entering={FadeIn.duration(200)}>
      <Text style={styles.inputLabel}>Share proof of a lower price</Text>
      <Text style={styles.uploadHelp}>{message}</Text>
      <View style={styles.uploadInfoBox}>
        <Text style={styles.uploadInfoText}>
          Add a screenshot or link and the merchant will review it.
        </Text>
      </View>
      <Pressable style={styles.uploadButton} onPress={onPickImage}>
        <Ionicons name="image-outline" size={18} color="#111827" />
        <Text style={styles.uploadButtonText}>
          {uploadFile ? 'Change Photo' : 'Upload Photo'}
        </Text>
      </Pressable>
      {uploadFile ? (
        <Text style={styles.selectedFileText}>Photo attached</Text>
      ) : null}
      <Text style={styles.orText}>OR</Text>
      <TextInput
        style={styles.linkInput}
        value={uploadLink}
        onChangeText={onUploadLinkChange}
        placeholder="Paste competitor product URL"
        placeholderTextColor={palette.gray[400]}
        autoCapitalize="none"
      />
      <Text style={styles.inputLabel}>
        Phone / WhatsApp (required for guest requests)
      </Text>
      <Text style={styles.uploadHelp}>
        Add a number so the merchant can reach you about this offer.
      </Text>
      <TextInput
        style={styles.linkInput}
        accessibilityLabel="Phone or WhatsApp number (required for guest requests)"
        value={phone}
        onChangeText={onPhoneChange}
        placeholder="e.g. 0803 123 4567"
        placeholderTextColor={palette.gray[400]}
        keyboardType="phone-pad"
        autoCapitalize="none"
        autoComplete="tel"
        textContentType="telephoneNumber"
      />
      <View style={styles.uploadActions}>
        <Pressable style={styles.backButton} onPress={onBackFromUpload}>
          <Text style={styles.backButtonText}>Back</Text>
        </Pressable>
        <Pressable style={styles.sendReviewButton} onPress={onUploadSubmit}>
          <Ionicons name="cloud-upload" size={16} color="#FFF" />
          <Text style={styles.sendReviewButtonText}>Send for Review</Text>
        </Pressable>
      </View>
    </Animated.View>
  );
}

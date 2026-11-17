import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { BRAND } from '@/constants/Colors';
import type { SwapUploadStepProps } from './SwapTradeInModal.types';
import { swapScreenStyles as styles } from './swap-screen.styles';

export function SwapTradeInUploadStep({
  colors,
  error,
  isAnalyzing,
  onClearMedia,
  onPickMedia,
  onRecordVideo,
  onStartAnalysis,
  mediaLabel,
}: SwapUploadStepProps) {
  return (
    <>
      <View style={[styles.uploadArea, { borderColor: colors.border }]}>
        <View
          style={[
            styles.uploadIconContainer,
            { backgroundColor: colors.background },
          ]}
        >
          <Ionicons name="camera" size={32} color={BRAND.primary} />
        </View>
        <Text style={[styles.uploadTitle, { color: colors.text }]}>
          Upload Photos or a Video of Your Device
        </Text>
        <Text style={[styles.uploadDesc, { color: colors.textSecondary }]}>
          Show the screen and back clearly. Up to 6 photos, or one short video.
        </Text>

        {mediaLabel ? (
          <View style={styles.videoSelected}>
            <View
              style={[
                styles.videoSelectedBadge,
                { backgroundColor: colors.muted },
              ]}
            >
              <Ionicons name="checkmark" size={14} color={colors.success} />
              <Text
                style={[styles.videoSelectedText, { color: colors.success }]}
              >
                {mediaLabel}
              </Text>
            </View>
            <Pressable onPress={onClearMedia}>
              <Text style={[styles.removeVideoText, { color: colors.error }]}>
                Remove
              </Text>
            </Pressable>
          </View>
        ) : (
          <View style={styles.uploadButtons}>
            <Pressable
              style={[styles.uploadButton, { backgroundColor: BRAND.primary }]}
              onPress={onPickMedia}
            >
              <Ionicons name="folder" size={18} color={colors.white} />
              <Text style={[styles.uploadButtonText, { color: colors.white }]}>
                Select Photos or Video
              </Text>
            </Pressable>
            <Pressable
              style={[styles.uploadButton, { backgroundColor: colors.text }]}
              onPress={onRecordVideo}
            >
              <Ionicons name="videocam" size={18} color={colors.white} />
              <Text style={[styles.uploadButtonText, { color: colors.white }]}>
                Record Video
              </Text>
            </Pressable>
          </View>
        )}
      </View>

      {error && (
        <View
          style={[styles.errorContainer, { backgroundColor: colors.muted }]}
        >
          <Text style={[styles.errorText, { color: colors.error }]}>
            {error}
          </Text>
        </View>
      )}

      <Pressable
        style={[
          styles.analyzeButton,
          { backgroundColor: BRAND.primary },
          (!mediaLabel || isAnalyzing) && styles.analyzeButtonDisabled,
        ]}
        onPress={onStartAnalysis}
        disabled={!mediaLabel || isAnalyzing}
      >
        <Text style={[styles.analyzeButtonText, { color: colors.white }]}>
          Analyze Device
        </Text>
        <Ionicons name="arrow-forward" size={20} color={colors.white} />
      </Pressable>
    </>
  );
}

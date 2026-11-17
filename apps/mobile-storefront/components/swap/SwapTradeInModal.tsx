import Ionicons from '@react-native-vector-icons/ionicons';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';
import { BRAND } from '@/constants/Colors';
import type {
  SwapModalStep,
  SwapTradeInModalProps,
} from './SwapTradeInModal.types';
import { SwapTradeInResultStep } from './SwapTradeInResultStep';
import { SwapTradeInUploadStep } from './SwapTradeInUploadStep';
import { swapScreenStyles as styles } from './swap-screen.styles';

export type { SwapModalStep };

export function SwapTradeInModal({
  colors,
  error,
  isAnalyzing,
  result,
  step,
  mediaLabel,
  visible,
  onAcceptOffer,
  onClose,
  onClearMedia,
  onPickMedia,
  onRecordVideo,
  onReset,
  onStartAnalysis,
}: SwapTradeInModalProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={[styles.modalContent, { backgroundColor: colors.card }]}>
          <View
            style={[styles.modalHeader, { borderBottomColor: colors.border }]}
          >
            <View style={styles.modalHeaderTitle}>
              <Ionicons name="sparkles" size={20} color={BRAND.primary} />
              <Text style={[styles.modalTitle, { color: colors.text }]}>
                AI Trade-in Valuator
              </Text>
            </View>
            <Pressable onPress={onClose}>
              <Ionicons name="close" size={24} color={colors.textSecondary} />
            </Pressable>
          </View>

          <View style={styles.modalBody}>
            {step === 'upload' && (
              <SwapTradeInUploadStep
                colors={colors}
                error={error}
                isAnalyzing={isAnalyzing}
                onClearMedia={onClearMedia}
                onPickMedia={onPickMedia}
                onRecordVideo={onRecordVideo}
                onStartAnalysis={onStartAnalysis}
                mediaLabel={mediaLabel}
              />
            )}

            {step === 'analyzing' && (
              <View style={styles.analyzingContainer}>
                <View style={styles.analyzingSpinner}>
                  <ActivityIndicator size="large" color={BRAND.primary} />
                  <View style={styles.sparkleIcon}>
                    <Ionicons name="sparkles" size={24} color={BRAND.primary} />
                  </View>
                </View>
                <Text style={[styles.analyzingTitle, { color: colors.text }]}>
                  Gemini AI is Analyzing…
                </Text>
                <Text
                  style={[
                    styles.analyzingDesc,
                    { color: colors.textSecondary },
                  ]}
                >
                  Checking screen condition… Identifying model…
                </Text>
              </View>
            )}

            {step === 'result' && (
              <SwapTradeInResultStep
                colors={colors}
                onAcceptOffer={onAcceptOffer}
                onReset={onReset}
                result={result}
              />
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

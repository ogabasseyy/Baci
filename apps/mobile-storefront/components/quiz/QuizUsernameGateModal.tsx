import Ionicons from '@react-native-vector-icons/ionicons';
import { Pressable, Text, View } from 'react-native';
import { UsernamePrompt } from '@/components/account/UsernamePrompt';
import { ModalSheet } from '@/components/ui/ModalSheet';
import { useTheme } from '@/hooks/useTheme';
import { quizUsernameGateStyles as styles } from './QuizUsernameGateModal.styles';

interface QuizUsernameGateModalProps {
  onCancel: () => void;
  onSuccess: (username: string) => void;
  visible: boolean;
}

/**
 * Blocks quiz attempts until the customer picks a username — quiz results
 * are shown on a public leaderboard, so a display name must exist first.
 */
export function QuizUsernameGateModal({
  onCancel,
  onSuccess,
  visible,
}: QuizUsernameGateModalProps) {
  const { colors } = useTheme();

  return (
    <ModalSheet
      visible={visible}
      animationType="slide"
      backdropStyle={styles.backdrop}
      cardStyle={[styles.card, { backgroundColor: colors.background }]}
      onBackdropPress={onCancel}
      onRequestClose={onCancel}
    >
      <View style={styles.topRow}>
        <View
          accessibilityLabel="Leaderboard identity"
          accessibilityRole="image"
          style={[
            styles.iconBadge,
            { backgroundColor: colors.primaryLowOpacity },
          ]}
        >
          <Ionicons name="trophy-outline" size={24} color={colors.primary} />
        </View>
        <Pressable
          accessibilityLabel="Cancel username setup"
          accessibilityRole="button"
          onPress={onCancel}
          style={styles.iconButton}
        >
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </Pressable>
      </View>
      <View style={styles.headingGroup}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: colors.text }]}
        >
          Choose a username
        </Text>
        <Text style={[styles.helperText, { color: colors.textSecondary }]}>
          This name will appear on the leaderboard at the end of the quiz.
        </Text>
      </View>
      <UsernamePrompt onSuccess={onSuccess} submitLabel="Save & continue" />
    </ModalSheet>
  );
}

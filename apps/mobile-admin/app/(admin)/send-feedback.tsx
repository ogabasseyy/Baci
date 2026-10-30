import { useRouter } from 'expo-router';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { SPACING } from '@/constants/theme';
import { useTheme } from '@/hooks/useTheme';

/** Menu → Support → Send Feedback; same report as the floating bug button. */
export default function SendFeedbackScreen() {
  const { colors } = useTheme();
  const router = useRouter();

  const handleSent = () => {
    Alert.alert('Thanks for the feedback', 'The Baci team will look into it.', [
      { text: 'OK', onPress: () => router.back() },
    ]);
  };

  return (
    <SafeAreaView
      edges={['bottom']}
      style={[styles.container, { backgroundColor: colors.background }]}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <FeedbackForm
          onCancel={() => router.back()}
          onSent={handleSent}
          screen="/send-feedback"
          showTitle={false}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
  },
});

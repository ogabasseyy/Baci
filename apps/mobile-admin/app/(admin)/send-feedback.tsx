import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack, useRouter } from 'expo-router';
import { Alert, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FeedbackForm } from '@/components/feedback/FeedbackForm';
import { AppKeyboardContainer } from '@/components/ui/AppKeyboardContainer';
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
    <>
      <Stack.Screen
        options={{
          title: 'Send Feedback',
          headerLeft: () => (
            <Pressable
              accessibilityLabel="Go back"
              accessibilityRole="button"
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <SafeAreaView
        edges={['bottom']}
        style={[styles.container, { backgroundColor: colors.background }]}
      >
        {/* The form autofocuses its message box; keep Send above the keyboard. */}
        <AppKeyboardContainer
          align="start"
          contentContainerStyle={styles.content}
          offsetPreset="compactHeader"
        >
          <FeedbackForm
            onCancel={() => router.back()}
            onSent={handleSent}
            screen="/send-feedback"
            showTitle={false}
          />
        </AppKeyboardContainer>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  backButton: { padding: SPACING.sm, marginLeft: -SPACING.sm },
  container: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
  },
});

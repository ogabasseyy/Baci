import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  FEEDBACK_CATEGORIES,
  FeedbackCategoryChips,
} from '@/components/feedback/FeedbackCategoryChips';
import { FeedbackRatingSelector } from '@/components/feedback/FeedbackRatingSelector';
import { FeedbackSubmitButton } from '@/components/feedback/FeedbackSubmitButton';
import { getRuntimePlatform } from '@/config/runtime-platform';
import { RADIUS, SPACING, TYPOGRAPHY } from '@/constants/theme';
import { useAuth } from '@/hooks/useAuth';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';

interface FeedbackSubmission {
  categories: string[];
  merchantId: string;
  message: string | null;
  rating: number;
  userId: string;
}

// Module-scope helper: try/catch with a finalizer and throws cannot live in
// the component body because React Compiler does not lower that syntax yet.
async function submitFeedback({
  categories,
  merchantId,
  message,
  rating,
  userId,
}: FeedbackSubmission): Promise<boolean> {
  // Real feedback submission to Supabase
  try {
    const { error: insertError } = await supabase.from('feedback').insert({
      merchant_id: merchantId,
      user_id: userId,
      rating: rating,
      categories: categories,
      message: message,
      platform: getRuntimePlatform(),
    });

    if (insertError) throw insertError;
    return true;
  } catch (error) {
    console.error('Feedback submit error:', error);
    return false;
  }
}

export default function SendFeedbackScreen() {
  const { colors, shadows, isDark } = useTheme();
  const { merchant } = useMerchant();
  const { user } = useAuth();
  const router = useRouter();

  const [rating, setRating] = useState<number | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [isSending, setIsSending] = useState(false);

  const toggleCategory = (categoryId: string) => {
    setSelectedCategories((prev) =>
      prev.includes(categoryId)
        ? prev.filter((id) => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const handleSubmit = async () => {
    if (rating === null) {
      Alert.alert(
        'Missing Rating',
        'Please select a rating for your experience.'
      );
      return;
    }

    if (!merchant?.id || !user?.id) {
      Alert.alert(
        'Please wait',
        'Your account is still loading. Try again in a moment.'
      );
      return;
    }

    setIsSending(true);
    const didSubmit = await submitFeedback({
      categories: selectedCategories,
      merchantId: merchant.id,
      message: message.trim() || null,
      rating,
      userId: user.id,
    });
    setIsSending(false);

    if (didSubmit) {
      Alert.alert(
        'Thank You! 🎉',
        'Your feedback has been submitted. We appreciate you taking the time to help us improve!',
        [{ text: 'OK', onPress: () => router.back() }]
      );
      return;
    }

    Alert.alert('Error', 'Failed to submit feedback. Please try again.');
  };

  return (
    <>
      <Stack.Screen
        options={{
          title: 'Send Feedback',
          headerLeft: () => (
            <Pressable onPress={() => router.back()} style={styles.backButton}>
              <Ionicons name="arrow-back" size={24} color={colors.text} />
            </Pressable>
          ),
        }}
      />
      <SafeAreaView
        style={[styles.container, { backgroundColor: colors.background }]}
        edges={['bottom']}
      >
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} />

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Rating Section */}
          <View
            style={[styles.card, { backgroundColor: colors.card }, shadows.sm]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              How would you rate your experience?
            </Text>
            <FeedbackRatingSelector
              rating={rating}
              onSelectRating={setRating}
            />
          </View>

          {/* Categories */}
          <View
            style={[styles.card, { backgroundColor: colors.card }, shadows.sm]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              What would you like to give feedback on?
            </Text>
            <Text
              style={[styles.sectionSubtitle, { color: colors.textSecondary }]}
            >
              Select all that apply
            </Text>
            <FeedbackCategoryChips
              categories={FEEDBACK_CATEGORIES}
              selectedCategories={selectedCategories}
              onToggleCategory={toggleCategory}
            />
          </View>

          {/* Message Input */}
          <View
            style={[styles.card, { backgroundColor: colors.card }, shadows.sm]}
          >
            <Text style={[styles.sectionTitle, { color: colors.text }]}>
              Tell us more (optional)
            </Text>
            <TextInput
              style={[
                styles.textArea,
                {
                  backgroundColor: colors.cardHover,
                  color: colors.text,
                  borderColor: colors.border,
                },
              ]}
              value={message}
              onChangeText={setMessage}
              placeholder="What could we do better? Any features you'd love to see?"
              placeholderTextColor={colors.textMuted}
              multiline
              numberOfLines={5}
              textAlignVertical="top"
            />
          </View>

          {/* Submit Button */}
          <FeedbackSubmitButton isSending={isSending} onPress={handleSubmit} />

          {/* Footer */}
          <View style={styles.footer}>
            <Ionicons name="heart" size={16} color={colors.error} />
            <Text style={[styles.footerText, { color: colors.textSecondary }]}>
              Your feedback helps us improve Baci for everyone!
            </Text>
          </View>
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  backButton: { padding: SPACING.sm, marginLeft: -SPACING.sm },
  scrollView: { flex: 1 },
  scrollContent: { padding: SPACING.lg, paddingBottom: SPACING['3xl'] },
  card: {
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    marginBottom: SPACING.sm,
  },
  sectionSubtitle: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
    marginBottom: SPACING.md,
  },
  textArea: {
    minHeight: 120,
    borderWidth: 1,
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    fontSize: TYPOGRAPHY.size.md,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.xs,
  },
  footerText: {
    fontSize: TYPOGRAPHY.size.sm,
    fontFamily: TYPOGRAPHY.fontFamily.regular,
  },
});

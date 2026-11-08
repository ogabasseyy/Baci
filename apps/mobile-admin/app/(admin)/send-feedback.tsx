import Ionicons from '@react-native-vector-icons/ionicons';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StatusBar,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getRuntimePlatform } from '@/config/runtime-platform';
import { useAuth } from '@/hooks/useAuth';
import { useMerchant } from '@/hooks/useMerchant';
import { useTheme } from '@/hooks/useTheme';
import { supabase } from '@/lib/supabase';
import { styles } from './send-feedback.styles';

const RATING_EMOJIS = ['😞', '😕', '😐', '🙂', '😍'];
const RATING_LABELS = ['Very Poor', 'Poor', 'Okay', 'Good', 'Excellent'];

const FEEDBACK_CATEGORIES = [
  {
    id: 'experience',
    label: 'App Experience',
    icon: 'phone-portrait-outline' as const,
  },
  { id: 'features', label: 'Features', icon: 'grid-outline' as const },
  {
    id: 'performance',
    label: 'Performance',
    icon: 'speedometer-outline' as const,
  },
  { id: 'design', label: 'Design', icon: 'color-palette-outline' as const },
  { id: 'other', label: 'Other', icon: 'ellipsis-horizontal-outline' as const },
];

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
            <View style={styles.ratingContainer}>
              {RATING_EMOJIS.map((emoji, index) => (
                <Pressable
                  key={emoji}
                  style={[
                    styles.ratingButton,
                    {
                      backgroundColor:
                        rating === index + 1
                          ? `${colors.primary}20`
                          : colors.cardHover,
                      borderColor:
                        rating === index + 1 ? colors.primary : 'transparent',
                      borderWidth: rating === index + 1 ? 2 : 0,
                    },
                  ]}
                  onPress={() => setRating(index + 1)}
                >
                  <Text style={styles.ratingEmoji}>{emoji}</Text>
                </Pressable>
              ))}
            </View>
            {rating !== null && (
              <Text style={[styles.ratingLabel, { color: colors.primary }]}>
                {RATING_LABELS[rating - 1]}
              </Text>
            )}
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
            <View style={styles.categoriesGrid}>
              {FEEDBACK_CATEGORIES.map((category) => {
                const isSelected = selectedCategories.includes(category.id);
                return (
                  <Pressable
                    key={category.id}
                    style={[
                      styles.categoryChip,
                      {
                        backgroundColor: isSelected
                          ? colors.primary
                          : colors.cardHover,
                      },
                    ]}
                    onPress={() => toggleCategory(category.id)}
                  >
                    <Ionicons
                      name={category.icon}
                      size={16}
                      color={isSelected ? colors.textOnPrimary : colors.text}
                    />
                    <Text
                      style={[
                        styles.categoryChipText,
                        {
                          color: isSelected
                            ? colors.textOnPrimary
                            : colors.text,
                        },
                      ]}
                    >
                      {category.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
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
          <Pressable
            style={[
              styles.submitButton,
              { backgroundColor: colors.primary, opacity: isSending ? 0.7 : 1 },
            ]}
            onPress={handleSubmit}
            disabled={isSending}
          >
            {isSending ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <>
                <Ionicons
                  name="paper-plane"
                  size={20}
                  color={colors.textOnPrimary}
                />
                <Text
                  style={[
                    styles.submitButtonText,
                    { color: colors.textOnPrimary },
                  ]}
                >
                  Submit Feedback
                </Text>
              </>
            )}
          </Pressable>

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

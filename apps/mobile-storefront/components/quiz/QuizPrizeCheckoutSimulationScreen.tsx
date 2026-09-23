import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CheckoutScreenView } from '@/components/checkout/CheckoutScreenView';
import { useColorScheme } from '@/components/useColorScheme';
import Colors, { BRAND, RADIUS, SPACING } from '@/constants/Colors';
import type { QuizPrizeProduct } from '@/services/quiz-types';
import { useQuizStore } from '@/stores/quiz-store';

interface QuizPrizeCheckoutSimulationScreenProps {
  prize: QuizPrizeProduct;
}

export function QuizPrizeCheckoutSimulationScreen({
  prize,
}: QuizPrizeCheckoutSimulationScreenProps) {
  const [isComplete, setIsComplete] = useState(false);
  const colors = Colors[useColorScheme() ?? 'light'];
  const dismissRecovery = useQuizStore((state) => state.dismissRecovery);
  const resetQuiz = useQuizStore((state) => state.reset);

  useEffect(() => {
    if (!isComplete || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        void dismissRecovery();
        resetQuiz();
        router.back();
        return true;
      }
    );
    return () => subscription.remove();
  }, [dismissRecovery, isComplete, resetQuiz]);

  if (isComplete) {
    return (
      <View
        style={[styles.confirmation, { backgroundColor: colors.background }]}
      >
        {prize.imageUrl ? (
          <Image source={prize.imageUrl} style={styles.image} />
        ) : null}
        <Text style={styles.eyebrow}>TEST SIMULATION COMPLETE</Text>
        <Text style={[styles.title, { color: colors.text }]}>
          Prize checkout confirmed
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          This preview created no order, charged no payment, and changed no
          inventory.
        </Text>
        <Pressable
          accessibilityLabel="Back to quizzes"
          accessibilityRole="button"
          onPress={() => {
            void dismissRecovery();
            resetQuiz();
            router.back();
          }}
          style={styles.button}
        >
          <Text style={styles.buttonText}>Back to quizzes</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <CheckoutScreenView
      prizeSimulation={{
        item: {
          condition: prize.condition ?? undefined,
          id: `quiz-test-${prize.id}`,
          image_url: prize.imageUrl ?? undefined,
          name: prize.name,
          price: 0,
          product_id: prize.id,
          quantity: 1,
          slug: prize.id,
          variant_id: prize.variantId ?? undefined,
        },
        onComplete: () => setIsComplete(true),
      }}
    />
  );
}

const styles = StyleSheet.create({
  body: {
    fontSize: 16,
    lineHeight: 24,
    marginBottom: SPACING.xl,
    textAlign: 'center',
  },
  button: {
    backgroundColor: BRAND.primary,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.md,
  },
  buttonText: {
    color: BRAND.onPrimary,
    fontSize: 16,
    fontWeight: '700',
  },
  confirmation: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    padding: SPACING.xl,
  },
  eyebrow: {
    color: BRAND.primary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: SPACING.sm,
  },
  image: {
    height: 150,
    marginBottom: SPACING.lg,
    width: 150,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    marginBottom: SPACING.sm,
    textAlign: 'center',
  },
});

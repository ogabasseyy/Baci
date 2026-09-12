import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import type { QuizPrizeProduct } from '@/services/quiz-types';
import type { createQuizStyles } from './QuizScreen.styles';

interface QuizTestPrizeSimulationPanelProps {
  prize: QuizPrizeProduct;
  styles: ReturnType<typeof createQuizStyles>;
}

export function QuizTestPrizeSimulationPanel({
  prize,
  styles,
}: QuizTestPrizeSimulationPanelProps) {
  const router = useRouter();

  return (
    <View>
      <Text style={styles.prizeWinText}>Winner checkout preview</Text>
      <Text style={styles.prizeClaimHint}>
        Test the {prize.name} claim flow without creating a real order.
      </Text>
      <Pressable
        accessibilityLabel="Redeem prize"
        accessibilityRole="button"
        onPress={() =>
          router.push({
            pathname: '/quiz/prize-checkout-simulation',
            params: {
              condition: prize.condition ?? '',
              imageUrl: prize.imageUrl ?? '',
              name: prize.name,
              productId: prize.id,
              variantId: prize.variantId ?? '',
            },
          })
        }
        style={styles.primaryButton}
      >
        <Text style={styles.primaryButtonText}>Redeem prize</Text>
      </Pressable>
    </View>
  );
}
